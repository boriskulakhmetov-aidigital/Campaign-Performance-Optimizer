import type { Context } from '@netlify/functions';
import { requireAuth } from './_shared/auth.ts';
import { log } from './_shared/logger.ts';
import { supabase, writeJobStatus, updateSession } from './_shared/supabase.ts';
import { trackTokens } from './_shared/access.ts';
import { GoogleGenAI } from '@google/genai';
import { extractGeminiTokens } from '@boriskulakhmetov-aidigital/design-system/utils';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = 'gemini-3.1-pro-preview';

const OPTIMIZE_PROMPT = `You are an expert ad copywriter and campaign optimizer.

Given a list of underperforming ads, generate improved headline and description variations for each one.

For each variation:
1. Apply specific copywriting techniques (tag them precisely)
2. Explain your rationale briefly
3. Generate 2-3 variations per underperforming ad

Available technique tags:
- added_numbers: Include specific numbers/stats
- benefit_first: Lead with the outcome, not the feature
- urgency: Add time pressure or scarcity
- social_proof: Reference user counts, testimonials, awards
- question_hook: Open with an engaging question
- specificity: Replace vague claims with concrete details
- shorter: Reduce word count for punchier copy
- longer: Add detail where brevity lost clarity
- emotional: Use emotional language/triggers
- keyword_loaded: Include high-intent search keywords
- power_words: Use high-conversion words (free, proven, exclusive)
- negative_framing: Frame around loss aversion
- comparison: Position against alternatives

Return ONLY valid JSON:

{
  "variations": [
    {
      "adId": "<original ad id or index>",
      "adGroup": "<ad group for reference>",
      "originalHeadline": "<what we're improving>",
      "originalDescription": "<what we're improving>",
      "changeType": "headline|description|both",
      "headline": "<new headline or null>",
      "description": "<new description or null>",
      "techniques": ["technique_tag_1", "technique_tag_2"],
      "rationale": "<1-2 sentence explanation>"
    }
  ]
}`;

export default async (req: Request, _context: Context) => {
  const { userId, email } = await requireAuth(req);
  const { jobId, sessionId, campaignId, analysisData } = await req.json();

  log.info('optimize.start', {
    function_name: 'optimize-background',
    user_id: userId,
    user_email: email,
    entity_id: jobId,
    ai_provider: 'gemini',
    ai_model: MODEL,
    meta: { sessionId, campaignId },
  });

  await writeJobStatus(jobId, {
    status: 'streaming',
    phase: 'optimizing',
    partial_text: 'Generating optimized ad variations...',
  });

  try {
    // Filter to underperformers only
    const underperformers = (analysisData.ads || []).filter((a: any) => a.isUnderperformer);
    if (underperformers.length === 0) {
      await writeJobStatus(jobId, {
        status: 'complete',
        phase: 'optimized',
        partial_text: null,
      });
      return Response.json({ ok: true, message: 'No underperformers to optimize' });
    }

    const prompt = `${OPTIMIZE_PROMPT}

Campaign context:
- Platform: ${analysisData.campaign?.platform || 'google_search'}
- Objective: ${analysisData.campaign?.objective || 'conversions'}
- Vertical: ${analysisData.campaign?.vertical || 'unknown'}
- Audience: ${analysisData.campaign?.audienceType || 'broad'}

Underperforming ads to optimize:
${JSON.stringify(underperformers, null, 2)}`;

    const result = await ai.models.generateContent({
      model: MODEL,
      config: { temperature: 0.7, responseMimeType: 'application/json' },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    // Extract and log token usage
    const tokens = extractGeminiTokens(result);
    trackTokens(userId, 'campaign-optimizer', 'google', MODEL, tokens.inputTokens, tokens.outputTokens, tokens.totalTokens).catch(() => {});

    const text = result.text ?? '';
    let optimizeData: any;

    try {
      optimizeData = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        optimizeData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse optimization response as JSON');
      }
    }

    // Look up ad IDs from cpo_ads table by campaign
    const { data: dbAds } = await (supabase as any)
      .from('cpo_ads')
      .select('id, ad_group, headline')
      .eq('campaign_id', campaignId)
      .eq('is_underperformer', true);

    // Store variations in Supabase
    if (optimizeData.variations?.length && campaignId) {
      const variationRows = optimizeData.variations.map((v: any) => {
        // Try to match to DB ad by ad_group + headline
        const matchedAd = dbAds?.find(
          (a: any) => a.ad_group === v.adGroup || a.headline === v.originalHeadline,
        );
        return {
          ad_id: matchedAd?.id || dbAds?.[0]?.id,
          campaign_id: campaignId,
          user_id: userId,
          change_type: v.changeType || 'both',
          headline: v.headline || null,
          description: v.description || null,
          techniques: v.techniques || [],
          rationale: v.rationale || null,
          status: 'pending',
        };
      }).filter((r: any) => r.ad_id); // only insert if we matched an ad

      if (variationRows.length) {
        await (supabase as any).from('cpo_variations').insert(variationRows);
      }
    }

    // Update session report_data to include variations
    const { data: currentSession } = await (supabase as any)
      .from('cpo_sessions')
      .select('report_data')
      .eq('id', sessionId)
      .single();

    const updatedReportData = {
      ...(currentSession?.report_data || {}),
      variations: optimizeData.variations || [],
      summary: {
        ...(currentSession?.report_data?.summary || {}),
        variationsGenerated: optimizeData.variations?.length || 0,
      },
    };

    await updateSession(sessionId, {
      status: 'optimized',
      report_data: updatedReportData,
    });

    await writeJobStatus(jobId, {
      status: 'complete',
      phase: 'optimized',
      partial_text: null,
    });

    log.info('optimize.complete', {
      function_name: 'optimize-background',
      user_id: userId,
      user_email: email,
      entity_id: jobId,
      meta: { variationsGenerated: optimizeData.variations?.length },
    });

    return Response.json({ ok: true });
  } catch (err: any) {
    log.error('optimize.error', {
      function_name: 'optimize-background',
      user_id: userId,
      user_email: email,
      entity_id: jobId,
      message: err.message,
    });

    await writeJobStatus(jobId, {
      status: 'error',
      phase: 'optimize_failed',
      partial_text: err.message,
    });

    return Response.json({ error: err.message }, { status: 500 });
  }
};
