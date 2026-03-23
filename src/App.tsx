import {
  AppShell,
  ChatPanel,
  UploadZone,
} from '@boriskulakhmetov-aidigital/design-system'
import type { ChatMessage } from '@boriskulakhmetov-aidigital/design-system'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@clerk/react'
import { useOrchestrator } from './hooks/useOrchestrator'
import { parseGoogleAdsCsv } from './lib/csv-parser'
import CampaignSidebar from './components/CampaignSidebar'
import type { ParsedCsvResult } from './lib/types'
import './App.css'

const supabaseConfig = import.meta.env.VITE_SUPABASE_URL ? {
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  createClient: createClient as any,
} : undefined

interface AppProps {
  auth: { SignIn: any; UserButton: any; useAuth: any }
}

export default function App({ auth }: AppProps) {
  // Sidebar state (lifted above AppShell for ref-bridge)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null)
  const [sidebarSupabase, setSidebarSupabase] = useState<SupabaseClient | null>(null)

  // Ref-bridge: AppContent exposes handlers here
  const handlersRef = useRef<{
    onSelectSession: (id: string) => void
    onNewSession: () => void
    onDeleteSession: (id: string) => void
  }>({
    onSelectSession: () => {},
    onNewSession: () => {},
    onDeleteSession: () => {},
  })

  return (
    <AppShell
      appTitle="Campaign Performance Optimizer"
      activityLabel="Campaign"
      auth={auth}
      supabaseConfig={supabaseConfig}
      helpUrl="/help"
      sidebar={
        <CampaignSidebar
          refreshKey={sidebarRefreshKey}
          currentSessionId={currentSessionId}
          loadingSessionId={loadingSessionId}
          onSelectSession={(id) => handlersRef.current.onSelectSession(id)}
          onNewSession={() => handlersRef.current.onNewSession()}
          onDeleteSession={(id) => handlersRef.current.onDeleteSession(id)}
          supabase={sidebarSupabase}
        />
      }
    >
      {({ supabase }) => (
        <AppContent
          supabase={supabase}
          handlersRef={handlersRef}
          setSidebarSupabase={setSidebarSupabase}
          setSidebarRefreshKey={setSidebarRefreshKey}
          setCurrentSessionId={setCurrentSessionId}
          setLoadingSessionId={setLoadingSessionId}
        />
      )}
    </AppShell>
  )
}

/* ── Main Content ──────────────────────────────────────────────────── */

interface AppContentProps {
  supabase: SupabaseClient | null
  handlersRef: React.MutableRefObject<{
    onSelectSession: (id: string) => void
    onNewSession: () => void
    onDeleteSession: (id: string) => void
  }>
  setSidebarSupabase: (sb: SupabaseClient | null) => void
  setSidebarRefreshKey: React.Dispatch<React.SetStateAction<number>>
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setLoadingSessionId: React.Dispatch<React.SetStateAction<string | null>>
}

function AppContent({
  supabase,
  handlersRef,
  setSidebarSupabase,
  setSidebarRefreshKey,
  setCurrentSessionId,
  setLoadingSessionId,
}: AppContentProps) {
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<ParsedCsvResult | null>(null)

  // Expose supabase to sidebar
  useEffect(() => { setSidebarSupabase(supabase) }, [supabase, setSidebarSupabase])

  const refreshSidebar = useCallback(() => setSidebarRefreshKey(k => k + 1), [setSidebarRefreshKey])

  // The orchestrator IS the app — no separate phases, no background agents dispatched from here.
  // The LLM drives the entire conversation: ingest → analyze → discuss → optimize → report.
  const {
    messages, streaming, error: chatError,
    sendMessage, setCsvText, reset: resetOrchestrator, loadSession, sessionId,
  } = useOrchestrator(supabase, refreshSidebar)

  // Track current session in sidebar
  useEffect(() => {
    if (sessionId && messages.length > 0) setCurrentSessionId(sessionId)
  }, [sessionId, messages.length, setCurrentSessionId])

  // CSV file handler
  function handleCsvFile(file: File) {
    setCsvFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setCsvText(text)
      const result = parseGoogleAdsCsv(text)
      setCsvPreview(result)

      if (result.errors.length === 0) {
        sendMessage(
          `I've uploaded "${file.name}" — a Google Ads CSV with ${result.totalAds} ads across ${result.campaigns.length} campaign(s). Total spend: $${result.totalSpend.toFixed(2)}.`
        )
      } else {
        sendMessage(
          `I've uploaded "${file.name}". ${result.errors.join('. ')}. Please try to parse it.`
        )
      }
    }
    reader.readAsText(file)
  }

  // Sidebar handlers
  async function handleSelectSession(id: string) {
    if (!supabase) return
    setLoadingSessionId(id)
    try {
      const { data: session } = await supabase
        .from('cpo_sessions')
        .select('*')
        .eq('id', id)
        .single()
      if (!session) return
      setCurrentSessionId(id)
      loadSession({ id: session.id, messages: session.messages || [] })
    } finally {
      setLoadingSessionId(null)
    }
  }

  function handleNewSession() {
    resetOrchestrator()
    setCsvFileName(null)
    setCsvPreview(null)
    setCurrentSessionId(null)
  }

  async function handleDeleteSession(id: string) {
    if (supabase) {
      await supabase.from('cpo_sessions').update({ deleted_by_user: true }).eq('id', id)
    }
    if (sessionId === id) handleNewSession()
    refreshSidebar()
  }

  // Wire ref-bridge
  handlersRef.current = {
    onSelectSession: handleSelectSession,
    onNewSession: handleNewSession,
    onDeleteSession: handleDeleteSession,
  }

  return (
    <div className="cpo-chat-layout">
      <ChatPanel
        messages={messages}
        streaming={streaming}
        error={chatError}
        onSend={sendMessage}
        welcomeIcon="&#128202;"
        welcomeTitle="Campaign Performance Optimizer"
        welcomeDescription="Upload your Google Ads performance CSV to analyze campaign data, identify underperformers, and build an optimization plan together."
        placeholder="Describe your campaign or ask a question..."
        hints={[
          'Analyze my Google Ads campaign',
          'Which ads are underperforming and why?',
          'Help me optimize my competitor keyword ads',
        ]}
        inputPrefix={
          csvFileName ? (
            <div className="cpo-csv-badge">
              <span className="cpo-csv-badge__icon">&#128196;</span>
              <span className="cpo-csv-badge__name">{csvFileName}</span>
              {csvPreview && (
                <span className="cpo-csv-badge__meta">
                  {csvPreview.totalAds} ads &middot; {csvPreview.campaigns.length} campaign(s) &middot; ${csvPreview.totalSpend.toFixed(2)} spend
                </span>
              )}
              <button className="cpo-csv-badge__clear" onClick={() => { setCsvFileName(null); setCsvText(null); setCsvPreview(null) }}>&times;</button>
            </div>
          ) : (
            <UploadZone
              onFile={handleCsvFile}
              onUrl={() => {}}
              onClear={() => {}}
              accept=".csv,text/csv,application/vnd.ms-excel"
              maxSizeMB={50}
            />
          )
        }
      />
    </div>
  )
}
