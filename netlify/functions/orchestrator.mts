import type { Context } from '@netlify/functions';
import { requireAuth } from './_shared/auth.ts';
import { enforceAccess, trackUsage } from './_shared/access.ts';
import { log } from './_shared/logger.ts';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const APP_NAME = 'campaign-optimizer';

export default async (req: Request, _context: Context) => {
  try {
    const { userId, email } = await requireAuth(req);

    // Check access (tier/status gating)
    const access = await enforceAccess(userId, APP_NAME);
    if (!access.allowed) {
      return Response.json({ error: access.reason ?? 'Access denied' }, { status: 403 });
    }

    const { message, sessionId, messages } = await req.json();

    log.info('orchestrator.start', {
      function_name: 'orchestrator',
      user_id: userId,
      meta: { sessionId },
    });

    // TODO: Implement SSE streaming orchestration
    // This is a template — replace with your chat agent logic.
    //
    // Example SSE streaming pattern:
    //
    // const stream = new ReadableStream({
    //   async start(controller) {
    //     const encoder = new TextEncoder();
    //     function send(event: string, data: unknown) {
    //       controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    //     }
    //
    //     // Stream Gemini response
    //     const result = await ai.models.generateContentStream({
    //       model: 'gemini-3-flash-preview',
    //       contents: messages.map((m: any) => ({ role: m.role, parts: [{ text: m.content }] })),
    //     });
    //     for await (const chunk of result) {
    //       send('delta', { text: chunk.text() });
    //     }
    //
    //     send('done', {});
    //     controller.close();
    //   },
    // });
    //
    // return new Response(stream, {
    //   headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    // });

    // Track usage
    await trackUsage(userId, APP_NAME);

    // Placeholder response
    return Response.json({ reply: `Echo: ${message}` });
  } catch (err: any) {
    log.error('orchestrator.error', {
      function_name: 'orchestrator',
      message: err.message,
    });
    return Response.json({ error: err.message }, { status: 500 });
  }
};
