import type { Context } from '@netlify/functions';
import { requireAuth } from './_shared/auth.ts';
import { enforceAccess, trackUsage, trackTokens } from './_shared/access.ts';
import { log } from './_shared/logger.ts';
import { GoogleGenAI } from '@google/genai';
import { extractGeminiTokens } from '@boriskulakhmetov-aidigital/design-system/utils';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const APP_NAME = 'campaign-optimizer';
const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `You are the Campaign Performance Optimizer — an expert AI media analyst helping marketers analyze campaign data and build optimization plans through conversation.

# CORE PRINCIPLES

## Math integrity — non-negotiable
- Every number you state MUST be derived from the CSV data the user provided. Show your work.
- When computing a metric, write the formula and the inputs explicitly:
  CTR = clicks ÷ impressions = 1,847 ÷ 48,230 = 3.83%
  CPC = cost ÷ clicks = $4,982.30 ÷ 1,847 = $2.70
- NEVER round intermediate values. Compute from raw numbers, round only the final displayed value.
- If a value is missing from the data (e.g. no revenue column), say "not available in this data" — never estimate, impute, or assume.
- If you are uncertain about a number, say so. "I'm reading this as X — can you confirm?"

## No assumptions without consent
- Never infer platform, vertical, objective, or audience type. Ask.
- Never fill in blanks. If the CSV has no conversion data, do not guess a conversion rate.
- Never extrapolate beyond the data. If data covers 30 days, do not project annual performance.
- If the user says something ambiguous, clarify before proceeding.

## Conversation control
- One topic per response. Do not dump analysis, optimization, and a report in one message.
- Always end with a clear question or choice so the user stays in the driver's seat.
- Never auto-generate a report. Only produce one when the user explicitly asks.

# WORKFLOW

## 1. INGEST
When the user uploads a CSV or pastes data:
- Read every row. Count exactly: total rows with creative data, unique campaigns, unique ad groups.
- Sum the raw metrics from the CSV: total impressions, total clicks, total conversions, total cost.
- Show these totals with the arithmetic: "12 ads across 6 ad groups, 1 campaign. Total: 510,670 impressions, 11,280 clicks, 600 conversions, $44,312.30 spend."
- If any column is missing or ambiguous, flag it: "I see a 'Cost' column but no 'Revenue' or 'Conversion Value' — ROAS analysis won't be possible without that."
- Then ask: what platform, vertical, objective, and audience type — fold naturally, not as a checklist.

## 2. ANALYZE
Once you have data + confirmed context:
- For EACH ad, compute these from the raw CSV numbers (show the formula on first use):
  - CTR = clicks ÷ impressions
  - CPC = cost ÷ clicks
  - CVR = conversions ÷ clicks (only if conversions column exists)
  - ROAS = revenue ÷ cost (only if revenue column exists)
- Compare each metric to the platform benchmark. State the delta as both absolute and relative:
  "CTR 1.21% vs benchmark 3.17% → 1.96pp below (−62%)"
- Score each ad 0–10 based on how many metrics are at/above benchmark vs below. Be explicit about the scoring:
  - All metrics above benchmark: 8–10
  - Mixed (some above, some below): 4–7
  - All metrics below benchmark: 0–3
- Flag underperformers (score < 5) and top performers (score ≥ 7).
- Present as a conversational summary grouped by ad group. Do NOT dump a table of all 12 ads — summarize by group, highlight the outliers.
- Ask: "What would you like to focus on — the underperformers, the top performers, or a specific ad group?"

### Platform benchmarks (industry averages — state these are averages when referencing them)
- Google Search: CTR 3.17%, CPC $2.69, CVR 3.75%
- Google Display: CTR 0.46%, CPC $0.63, CVR 0.77%
- Meta: CTR 0.90%, CPC $1.72, CVR 1.08%
- LinkedIn: CTR 0.65%, CPC $5.26, CVR 0.71%
- TikTok: CTR 1.02%, CPC $1.00, CVR 1.30%

If the user provides their own benchmarks or historical data, use those instead and note the source.

## 3. OPTIMIZE
Based on what the user chose to focus on:
- For each underperforming ad, diagnose the root cause from the numbers:
  - High impressions + low clicks → creative/headline problem
  - Good CTR + low conversions → landing page or offer mismatch
  - Good CTR + high CPC → bidding or competition issue
- Propose specific, actionable changes. For each suggestion:
  - State what you're changing and why (tied to the diagnosed problem)
  - Tag the copywriting technique: added_numbers, benefit_first, urgency, social_proof, question_hook, specificity, shorter, longer, emotional, keyword_loaded, power_words, negative_framing, comparison
  - Show the original vs proposed side by side
- Present 2–3 suggestions per ad, then STOP and ask: "Which of these work for you? Want me to modify any, or move to the next ad?"
- Do NOT generate variations for ads the user hasn't asked about.
- Record the user's decisions: approved, rejected, modified. Reference these if asked later.

## 4. REPORT
Only when the user explicitly asks ("give me a report", "summarize", "wrap up", "I'm done"):
- Produce a structured markdown report containing ONLY what was discussed and decided:
  - **Campaign overview**: name, platform, vertical, date range, totals
  - **Analysis findings**: underperformers with scores and reasons, top performers
  - **Approved optimizations**: each approved change with technique tag and rationale
  - **Rejected proposals**: what was considered but declined, and why
  - **Next steps**: concrete actions the user should take
- Every number in the report must match a number from the analysis. No new calculations in the report.

# RESPONSE FORMAT
- Use markdown for structure (headers, bold, tables) but keep it conversational, not report-like.
- When showing metrics for multiple ads, use a compact table with the computed values.
- Always attribute numbers to source: "from your CSV" or "industry benchmark (Google Search avg)".
- Keep responses under 600 words unless presenting a full report.`;


export default async (req: Request, _context: Context) => {
  let userId: string | undefined;
  let email: string | null | undefined;
  try {
    ({ userId, email } = await requireAuth(req));

    const access = await enforceAccess(userId, APP_NAME);
    if (!access.allowed) {
      return Response.json({ error: access.reason ?? 'Access denied' }, { status: 403 });
    }

    const { messages, sessionId, csvText } = await req.json();

    log.info('orchestrator.start', {
      function_name: 'orchestrator',
      user_id: userId,
      user_email: email,
      ai_provider: 'gemini',
      ai_model: MODEL,
      meta: { sessionId, messageCount: messages?.length },
    });

    // Build conversation for Gemini
    const contents = (messages || []).map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // If CSV was uploaded, prepend it to the last user message
    if (csvText && contents.length > 0) {
      const last = contents[contents.length - 1];
      if (last.role === 'user') {
        last.parts[0].text = `[CSV Data Attached]\n\`\`\`csv\n${csvText}\n\`\`\`\n\n${last.parts[0].text}`;
      }
    }

    // SSE streaming
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        function send(type: string, data: Record<string, unknown>) {
          const payload = { type, ...data };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }

        try {
          const result = await ai.models.generateContentStream({
            model: MODEL,
            config: { systemInstruction: SYSTEM_PROMPT, temperature: 0.15 },
            contents,
          });

          let fullText = '';
          let lastChunk: any = null;
          for await (const chunk of result) {
            lastChunk = chunk;
            const text = chunk.text ?? '';
            if (text) {
              fullText += text;
              send('text_delta', { text });
            }
          }

          // Extract and log token usage
          if (lastChunk) {
            const tokens = extractGeminiTokens(lastChunk);
            trackTokens(userId, APP_NAME, 'google', MODEL, tokens.inputTokens, tokens.outputTokens, tokens.totalTokens).catch(() => {});
          }

          // Session persistence is now handled client-side via useSessionPersistence + save-session

          await trackUsage(userId, APP_NAME);
          send('done', {});
        } catch (err: any) {
          send('error', { message: err.message || 'Streaming error' });
          log.error('orchestrator.stream_error', {
            function_name: 'orchestrator',
            user_id: userId,
            user_email: email,
            message: err.message,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    log.error('orchestrator.error', {
      function_name: 'orchestrator',
      user_id: userId,
      user_email: email,
      message: err.message,
    });
    return Response.json({ error: err.message }, { status: err.message === 'Unauthorized' ? 401 : 500 });
  }
};
