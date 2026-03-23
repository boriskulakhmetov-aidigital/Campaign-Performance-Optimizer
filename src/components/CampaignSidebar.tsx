import { useState, useEffect } from 'react';
import { Sidebar } from '@boriskulakhmetov-aidigital/design-system';
import type { SupabaseClient } from '@supabase/supabase-js';

interface SessionItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface Props {
  refreshKey: number;
  currentSessionId: string | null;
  loadingSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  supabase: SupabaseClient | null;
}

export default function CampaignSidebar({
  refreshKey,
  currentSessionId,
  loadingSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  supabase,
}: Props) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('cpo_sessions')
      .select('id, title, status, created_at')
      .eq('deleted_by_user', false)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!data) return;
        setSessions(
          data.map((r: any) => ({
            id: r.id,
            title: r.title ?? 'New Campaign',
            status: r.status ?? 'chatting',
            createdAt: r.created_at,
          })),
        );
      });
  }, [refreshKey, supabase]);

  return (
    <Sidebar<SessionItem>
      items={sessions}
      activeId={currentSessionId}
      loadingId={loadingSessionId}
      onSelect={onSelectSession}
      onNew={onNewSession}
      onDelete={(id) => {
        onDeleteSession(id);
        setSessions(s => s.filter(x => x.id !== id));
      }}
      newLabel="+ New Campaign"
      emptyMessage="No campaigns yet. Upload a CSV to get started."
      renderItem={(item) => (
        <span className="aidl-sidebar__item-title">{item.title}</span>
      )}
    />
  );
}
