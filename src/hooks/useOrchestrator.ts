import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { parseSSEStream } from '@boriskulakhmetov-aidigital/design-system/utils';
import type { UseSessionPersistenceReturn } from '@boriskulakhmetov-aidigital/design-system';
import type { ChatMessage } from '@boriskulakhmetov-aidigital/design-system';

/**
 * Chat orchestrator hook — pure conversation, no dispatch.
 * The LLM drives the full workflow: ingest -> analyze -> optimize -> report.
 *
 * Uses DS useSessionPersistence for all persistence (messages, session lifecycle).
 */
export function useOrchestrator(
  session: UseSessionPersistenceReturn,
) {
  const { getToken } = useAuth();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const csvTextRef = useRef<string | null>(null);

  // Keep messagesRef in sync with session.messages
  messagesRef.current = session.messages;

  function setCsvText(text: string | null) {
    csvTextRef.current = text;
  }

  const sendMessage = useCallback(async (userText: string) => {
    setError(null);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: userText };
    session.addMessage(userMsg);
    messagesRef.current = [...messagesRef.current, userMsg];
    setStreaming(true);

    try {
      const token = await getToken();
      const res = await fetch('/.netlify/functions/orchestrator', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: messagesRef.current.map(m => ({ role: m.role, content: m.content })),
          sessionId: session.sessionId,
          csvText: csvTextRef.current,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Clear CSV after sending — only sent once
      csvTextRef.current = null;

      for await (const event of parseSSEStream(res.body!)) {
        if (event.type === 'text_delta') {
          session.updateLastAssistant((event as any).text);
        } else if (event.type === 'error') {
          throw new Error((event as any).message || 'Stream error');
        }
      }

      // Flush after stream completes to persist the full assistant message
      session.setMessages(prev => [...prev]);
      await session.flush();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setStreaming(false);
    }
  }, [getToken, session]);

  function reset() {
    csvTextRef.current = null;
    session.newSession();
    setError(null);
  }

  return {
    messages: session.messages,
    streaming,
    error,
    sendMessage,
    setCsvText,
    reset,
    sessionId: session.sessionId,
  };
}
