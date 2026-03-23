import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { parseSSEStream } from '@boriskulakhmetov-aidigital/design-system/utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatMessage } from '@boriskulakhmetov-aidigital/design-system';

interface State {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
}

/**
 * Chat orchestrator hook — pure conversation, no dispatch.
 * The LLM drives the full workflow: ingest → analyze → optimize → report.
 */
export function useOrchestrator(
  supabase: SupabaseClient | null,
  onSidebarRefresh?: () => void,
) {
  const { getToken, userId } = useAuth();
  const [state, setState] = useState<State>({ messages: [], streaming: false, error: null });
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionIdRef = useRef(crypto.randomUUID());
  const sessionSavedRef = useRef(false);
  const csvTextRef = useRef<string | null>(null);

  function setCsvText(text: string | null) {
    csvTextRef.current = text;
  }

  function updateLastAssistant(chunk: string) {
    const msgs = messagesRef.current;
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') {
      last.content += chunk;
    } else {
      msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: chunk });
    }
    messagesRef.current = [...msgs];
    setState(s => ({ ...s, messages: messagesRef.current }));
  }

  const sendMessage = useCallback(async (userText: string) => {
    setState(s => ({ ...s, error: null }));

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: userText };
    messagesRef.current = [...messagesRef.current, userMsg];
    setState(s => ({ ...s, messages: messagesRef.current, streaming: true }));

    // Create session on first message
    if (!sessionSavedRef.current && supabase && userId) {
      const title = userText.length > 60 ? userText.slice(0, 60) + '\u2026' : userText;
      const { error: upsertErr } = await supabase.from('cpo_sessions').upsert(
        {
          id: sessionIdRef.current,
          user_id: userId,
          status: 'chatting',
          title,
          messages: [{ role: 'user', content: userText }],
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (upsertErr) console.error('Session upsert failed:', upsertErr);
      sessionSavedRef.current = true;
      onSidebarRefresh?.();
    }

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
          sessionId: sessionIdRef.current,
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
          updateLastAssistant((event as any).text);
        } else if (event.type === 'error') {
          throw new Error((event as any).message || 'Stream error');
        }
      }

      // Persist messages after exchange
      if (supabase) {
        await supabase.from('cpo_sessions')
          .update({
            messages: messagesRef.current.map(m => ({ role: m.role, content: m.content })),
            updated_at: new Date().toISOString(),
          })
          .eq('id', sessionIdRef.current);
      }
    } catch (err: any) {
      setState(s => ({ ...s, error: err.message || 'Something went wrong' }));
    } finally {
      setState(s => ({ ...s, streaming: false }));
    }
  }, [getToken, userId, supabase, onSidebarRefresh]);

  function reset() {
    messagesRef.current = [];
    sessionIdRef.current = crypto.randomUUID();
    sessionSavedRef.current = false;
    csvTextRef.current = null;
    setState({ messages: [], streaming: false, error: null });
  }

  function loadSession(session: { id: string; messages: Array<{ role: string; content: string }> }) {
    const msgs: ChatMessage[] = (session.messages || []).map((m, i) => ({
      id: `${session.id}-${i}`,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    messagesRef.current = msgs;
    sessionIdRef.current = session.id;
    sessionSavedRef.current = true;
    csvTextRef.current = null;
    setState({ messages: msgs, streaming: false, error: null });
  }

  return {
    ...state,
    sessionId: sessionIdRef.current,
    sendMessage,
    setCsvText,
    reset,
    loadSession,
  };
}
