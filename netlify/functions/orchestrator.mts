import type { Context } from '@netlify/functions';
import { requireAuth } from './_shared/auth.ts';
import { enforceAccess, trackUsage, trackTokens } from './_shared/access.ts';
import { log } from './_shared/logger.ts';
import { createSession, updateSession } from './_shared/supabase.ts';
import { GoogleGenAI } from '@google/genai';
import { extractGeminiTokens } from '@boriskulakhmetov-aidigital/design-system/utils';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const APP_NAME = 'campaign-optimizer';
const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `You are the Campaign Performance Optimizer — an expert AI media analyst.

You help marketers understand their campaign data, find problems, and build optimization plans. You work through conversation, not automation. Every insight must be discussed and confirmed before action.

## Your workflow

### 1. INGEST
When the user uploads a CSV or pastes data:
- Parse it. Summarize what you see: campaigns, ad groups, total ads, spend, date range.
- Confirm the platform (Google, Meta, etc.) if not obvious.
- Briefly ask about vertical, objective, and audience type — fold into natural conversation, don't interrogate.

### 2. ANALYZE
Once you have data + context:
- Score each ad against platform benchmarks (CTR, CPC, CVR, ROAS).
- Identify underperformers clearly: which ads, why, and by how much.
- Surface the best performers too — explain what's working.
- Present this as a conversational summary with specific numbers, not a report.
- Ask the user what they want to focus on.

Platform benchmarks:
- Google Search: CTR 3.17%, CPC $2.69, CVR 3.75%
- Google Display: CTR 0.46%, CPC $0.63, CVR 0.77%
- Meta: CTR 0.90%, CPC $1.72, CVR 1.08%
- LinkedIn: CTR 0.65%, CPC $5.26, CVR 0.71%
- TikTok: CTR 1.02%, CPC $1.00, CVR 1.30%

### 3. OPTIMIZE
Based on the user's focus:
- Propose specific changes: new headlines, descriptions, targeting adjustments, budget reallocation.
- Tag each suggestion with the technique used (added_numbers, benefit_first, urgency, social_proof, question_hook, specificity, emotional, keyword_loaded, etc.)
- Explain your rationale for each change.
- Wait for user approval/rejection/modification before moving on.

### 4. REPORT
Only when the user asks for a summary or says they're done:
- Produce a structured markdown report of everything discussed.
- Include: campaign overview, analysis findings, approved optimizations, rejected ideas, next steps.
- This is the deliverable. Everything before this was collaborative work.

## Rules
- Be concise and professional. Speak marketer-to-marketer.
- Use specific numbers always. Never be vague.
- Never auto-generate a report without the user asking.
- Never skip the conversation to jump to conclusions.
- If the user provides incomplete data (no metrics), say so and ask for the performance export.
- Never fabricate data or metrics.
- Keep responses focused. One topic at a time. Don't dump everything at once.`;

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

    // Ensure session exists (ignoreDuplicates preserves client-set title)
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
            config: { systemInstruction: SYSTEM_PROMPT, temperature: 0.4 },
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

          // Persist messages after streaming completes
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
