import type { Context } from '@netlify/functions';
import { requireAuth } from './_shared/auth.ts';
import { enforceAccess, trackUsage } from './_shared/access.ts';
import { log } from './_shared/logger.ts';
import { createSession, updateSession } from './_shared/supabase.ts';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const APP_NAME = 'campaign-optimizer';
const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `You are the Campaign Performance Optimizer — an expert AI media analyst for digital advertising campaigns.

Your job:
1. Help users ingest campaign performance data (CSV uploads or manual input)
2. Analyze campaign performance and identify underperforming ads
3. Dispatch analysis when you have enough data

## Conversation flow

### Phase 1: Data intake
When the user uploads a CSV or pastes campaign data:
- Acknowledge receipt and summarize what you see (campaigns, ad groups, total ads, date range if present)
- Confirm the platform (Google Ads, Meta, etc.) and campaign objective if not obvious
- Ask about vertical/industry and audience type if not clear

### Phase 2: Context gathering
Ask briefly about:
- Campaign objective (conversions, traffic, awareness, leads)
- Vertical/industry
- Audience type (prospecting, retargeting, lookalike, broad)
- Budget context (optional)
Do NOT ask all at once — fold naturally into conversation.

### Phase 3: Analysis dispatch
Once you have the campaign data AND context, emit an analysis_dispatch event.

When you are ready to dispatch, your FINAL assistant message must end with exactly this JSON block (no text after it):

\`\`\`json:analysis_dispatch
{
  "campaignName": "<campaign name>",
  "platform": "<google_search|google_display|google_pmax|meta|tiktok|linkedin|dv360|other>",
  "objective": "<conversions|traffic|awareness|leads>",
  "vertical": "<industry/vertical>",
  "audienceType": "<prospecting|retargeting|lookalike|broad>",
  "csvData": "<the full CSV text the user uploaded, exactly as received>"
}
\`\`\`

## Rules
- Be concise and professional. You are talking to a marketer, not a beginner.
- Use numbers and specifics. Avoid vague statements.
- If the user pastes raw data (not CSV), reformat it mentally and proceed.
- If the data is clearly incomplete (no metrics), say so and ask for the performance export.
- Never fabricate data or metrics.`;

export default async (req: Request, _context: Context) => {
  try {
    const { userId, email } = await requireAuth(req);

    const access = await enforceAccess(userId, APP_NAME);
    if (!access.allowed) {
      return Response.json({ error: access.reason ?? 'Access denied' }, { status: 403 });
    }

    const { messages, sessionId, csvText } = await req.json();

    log.info('orchestrator.start', {
      function_name: 'orchestrator',
      user_id: userId,
      meta: { sessionId, messageCount: messages?.length },
    });

    // Ensure session exists
    if (sessionId) {
      await createSession({ id: sessionId, userId, userEmail: email ?? undefined });
    }

    // Build conversation for Gemini
    const contents = (messages || []).map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // If CSV was uploaded, prepend it to the last user message
    if (csvText && contents.length > 0) {
      const last = contents[contents.length - 1];
      if (last.role === 'user') {
        last.parts[0].text = `[CSV Upload]\n\`\`\`csv\n${csvText}\n\`\`\`\n\n${last.parts[0].text}`;
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
            config: { systemInstruction: SYSTEM_PROMPT, temperature: 0.3 },
            contents,
          });

          let fullText = '';
          for await (const chunk of result) {
            const text = chunk.text ?? '';
            if (text) {
              fullText += text;
              send('text_delta', { text });
            }
          }

          // Check for analysis_dispatch in the response
          const dispatchMatch = fullText.match(/```json:analysis_dispatch\s*\n([\s\S]*?)\n```/);
          if (dispatchMatch) {
            try {
              const dispatchData = JSON.parse(dispatchMatch[1]);
              send('analysis_dispatch', { analysisConfig: dispatchData });

              // Update session status
              if (sessionId) {
                await updateSession(sessionId, {
                  status: 'analyzing',
                  intake_summary: dispatchData,
                });
              }
            } catch {
              // JSON parse failure — not fatal, user still sees the text
            }
          }

          // Persist messages
          if (sessionId) {
            const allMessages = [
              ...(messages || []),
              { role: 'assistant', content: fullText },
            ];
            await updateSession(sessionId, {
              messages: allMessages.map((m: { role: string; content: string }) => ({
                role: m.role,
                content: m.content,
              })),
            });
          }

          // Track usage
          await trackUsage(userId, APP_NAME);

          send('done', {});
        } catch (err: any) {
          send('error', { message: err.message || 'Streaming error' });
          log.error('orchestrator.stream_error', {
            function_name: 'orchestrator',
            user_id: userId,
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
      message: err.message,
    });
    return Response.json({ error: err.message }, { status: err.message === 'Unauthorized' ? 401 : 500 });
  }
};
