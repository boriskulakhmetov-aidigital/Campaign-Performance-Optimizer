import type { Context } from '@netlify/functions';
import { requireAuth } from './_shared/auth.ts';
import { log } from './_shared/logger.ts';
import { supabase, writeJobStatus, updateSession } from './_shared/supabase.ts';
import { trackTokens } from './_shared/access.ts';
import { GoogleGenAI } from '@google/genai';
import { extractGeminiTokens } from '@AiDigital-com/design-system/utils';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = 'gemini-3.1-pro-preview';

const ANALYSIS_PROMPT = `You are an expert media analyst. Analyze the following campaign data and produce a structured JSON report.

For each ad, compute a performance score (0-10) based on:
- CTR relative to platform benchmarks
- CPC efficiency
- Conversion rate
- ROAS (if revenue data available)

Flag ads as underperformers if score < 5.

Return ONLY valid JSON matching this schema:

{
  "campaign": {
    "name": "<name>",
    "platform": "<platform>",
    "objective": "<objective>",
    "vertical": "<vertical>",
    "audienceType": "<audience_type>"
  },
  "summary": {
    "totalAds": <int>,
    "totalImpressions": <int>,
    "totalClicks": <int>,
    "totalConversions": <int>,
    "totalSpend": <float>,
    "totalRevenue": <float>,
    "avgCtr": <float>,
    "avgCpc": <float>,
    "avgCvr": <float>,
    "avgRoas": <float>,
    "underperformerCount": <int>
  },
  "ads": [
    {
      "adGroup": "<ad group>",
      "adFormat": "rsa",
      "headline": "<primary headline>",
      "description": "<primary description>",
      "finalUrl": "<url>",
      "impressions": <int>,
      "clicks": <int>,
      "conversions": <int>,
      "spend": <float>,
      "revenue": <float>,
      "score": <float 0-10>,
      "scoreReasons": [
        {"metric": "ctr", "value": <float>, "benchmark": <float>, "verdict": "below|at|above"},
        {"metric": "cpc", "value": <float>, "benchmark": <float>, "verdict": "below|at|above"},
        {"metric": "cvr", "value": <float>, "benchmark": <float>, "verdict": "below|at|above"}
      ],
      "isUnderperformer": <bool>
    }
  ]
}

Platform benchmarks to use:
- Google Search: CTR 3.17%, CPC $2.69, CVR 3.75%
- Google Display: CTR 0.46%, CPC $0.63, CVR 0.77%
- Meta: CTR 0.90%, CPC $1.72, CVR 1.08%
- LinkedIn: CTR 0.65%, CPC $5.26, CVR 0.71%
- TikTok: CTR 1.02%, CPC $1.00, CVR 1.30%

Adjust benchmarks based on the vertical if you have domain knowledge.`;

export default async (req: Request, _context: Context) => {
  const { userId, email } = await requireAuth(req);
  const { jobId, sessionId, analysisConfig } = await req.json();

  log.info('analyze.start', {
    function_name: 'analyze-background',
    user_id: userId,
    user_email: email,
    entity_id: jobId,
    ai_provider: 'gemini',
    ai_model: MODEL,
    meta: { sessionId, platform: analysisConfig?.platform },
  });

  await writeJobStatus(jobId, {
    status: 'streaming',
    phase: 'analyzing',
    partial_text: 'Analyzing campaign performance...',
  });

  try {
    const prompt = `${ANALYSIS_PROMPT}

Campaign context:
- Name: ${analysisConfig.campaignName}
- Platform: ${analysisConfig.platform}
- Objective: ${analysisConfig.objective}
- Vertical: ${analysisConfig.vertical}
- Audience: ${analysisConfig.audienceType}

CSV Data:
\`\`\`csv
${analysisConfig.csvData}
\`\`\``;

    const result = await ai.models.generateContent({
      model: MODEL,
      config: { temperature: 0.1, responseMimeType: 'application/json' },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    // Extract and log token usage
    const tokens = extractGeminiTokens(result);
    trackTokens(userId, 'campaign-optimizer', 'google', MODEL, tokens.inputTokens, tokens.outputTokens, tokens.totalTokens).catch(() => {});

    const text = result.text ?? '';
    let analysisData: any;

    try {
      analysisData = JSON.parse(text);
    } catch {
      // Try extracting JSON from markdown code block
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse analysis response as JSON');
      }
    }

    // Store campaign + ads in Supabase
    const campaignData = analysisData.campaign || {};
    const { data: campaign } = await (supabase as any)
      .from('cpo_campaigns')
      .insert({
        session_id: sessionId,
        user_id: userId,
        name: campaignData.name || analysisConfig.campaignName,
        platform: campaignData.platform || analysisConfig.platform,
        objective: campaignData.objective || analysisConfig.objective,
        vertical: campaignData.vertical || analysisConfig.vertical,
        audience_type: campaignData.audienceType || analysisConfig.audienceType,
        status: 'analyzed',
      })
      .select('id')
      .single();

    const campaignId = campaign?.id;

    if (campaignId && analysisData.ads?.length) {
      const adRows = analysisData.ads.map((ad: any) => ({
        campaign_id: campaignId,
        user_id: userId,
        ad_group: ad.adGroup || null,
        ad_format: ad.adFormat || 'rsa',
        headline: ad.headline || null,
        description: ad.description || null,
        final_url: ad.finalUrl || null,
        impressions: ad.impressions || 0,
        clicks: ad.clicks || 0,
        conversions: ad.conversions || 0,
        spend: ad.spend || 0,
        revenue: ad.revenue || 0,
        score: ad.score ?? null,
        score_reasons: ad.scoreReasons || null,
        is_underperformer: ad.isUnderperformer ?? false,
      }));

      await (supabase as any).from('cpo_ads').insert(adRows);
    }

    // Update session with report data
    await updateSession(sessionId, {
      status: 'analyzed',
      report_data: analysisData,
    });

    await writeJobStatus(jobId, {
      status: 'complete',
      phase: 'analyzed',
      partial_text: null,
    });

    log.info('analyze.complete', {
      function_name: 'analyze-background',
      user_id: userId,
      user_email: email,
      entity_id: jobId,
      meta: {
        totalAds: analysisData.ads?.length,
        underperformers: analysisData.summary?.underperformerCount,
      },
    });

    return Response.json({ ok: true });
  } catch (err: any) {
    log.error('analyze.error', {
      function_name: 'analyze-background',
      user_id: userId,
      user_email: email,
      entity_id: jobId,
      message: err.message,
    });

    await writeJobStatus(jobId, {
      status: 'error',
      phase: 'analyze_failed',
      partial_text: err.message,
    });

    return Response.json({ error: err.message }, { status: 500 });
  }
};
