import {
  AppShell,
  ChatPanel,
  UploadZone,
  useSessionPersistence,
} from '@boriskulakhmetov-aidigital/design-system'
import type { ChatMessage, UseSessionPersistenceReturn } from '@boriskulakhmetov-aidigital/design-system'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@clerk/react'
import { useOrchestrator } from './hooks/useOrchestrator'
import { parseGoogleAdsCsv } from './lib/csv-parser'
import { Sidebar } from '@boriskulakhmetov-aidigital/design-system'
import type { ParsedCsvResult } from './lib/types'
import './App.css'

const supabaseConfig = import.meta.env.VITE_SUPABASE_URL ? {
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  createClient: createClient as any,
} : undefined

const SESSION_CONFIG = {
  table: 'cpo_sessions',
  app: 'campaign-optimizer',
  titleField: 'title',
  defaultFields: { status: 'chatting' },
}

interface AppProps {
  auth: { SignIn: any; UserButton: any; useAuth: any }
}

export default function App({ auth }: AppProps) {
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

  // Session state for sidebar (set by AppContent via ref-bridge)
  const [sidebarSession, setSidebarSession] = useState<UseSessionPersistenceReturn | null>(null)

  return (
    <AppShell
      appTitle="Campaign Performance Optimizer"
      activityLabel="Campaign"
      auth={auth}
      supabaseConfig={supabaseConfig}
      helpUrl="/help"
      sidebar={
        sidebarSession ? (
          <Sidebar
            items={sidebarSession.sessions}
            activeId={sidebarSession.sessionId}
            onSelect={(id) => handlersRef.current.onSelectSession(id)}
            onNew={() => handlersRef.current.onNewSession()}
            onDelete={(id) => handlersRef.current.onDeleteSession(id)}
            newLabel="+ New Campaign"
            emptyMessage="No campaigns yet. Upload a CSV to get started."
            renderItem={(item) => (
              <span className="aidl-sidebar__item-title">{item.title}</span>
            )}
          />
        ) : null
      }
    >
      {({ supabase, authFetch }) => (
        <AppContent
          supabase={supabase}
          authFetch={authFetch}
          handlersRef={handlersRef}
          setSidebarSession={setSidebarSession}
        />
      )}
    </AppShell>
  )
}

/* -- Main Content --------------------------------------------------------- */

interface AppContentProps {
  supabase: SupabaseClient | null
  authFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null
  handlersRef: React.MutableRefObject<{
    onSelectSession: (id: string) => void
    onNewSession: () => void
    onDeleteSession: (id: string) => void
  }>
  setSidebarSession: (s: UseSessionPersistenceReturn) => void
}

function AppContent({
  supabase,
  authFetch,
  handlersRef,
  setSidebarSession,
}: AppContentProps) {
  const { userId } = useAuth()
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<ParsedCsvResult | null>(null)

  const session = useSessionPersistence(supabase, authFetch ?? null, userId ?? null, SESSION_CONFIG)

  // Expose session to sidebar
  useEffect(() => { setSidebarSession(session) }, [session, setSidebarSession])

  const {
    messages, streaming, error: chatError,
    sendMessage, setCsvText, reset: resetOrchestrator, sessionId,
  } = useOrchestrator(session)

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
          `I've uploaded "${file.name}" -- a Google Ads CSV with ${result.totalAds} ads across ${result.campaigns.length} campaign(s). Total spend: $${result.totalSpend.toFixed(2)}.`
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
    await session.loadSession(id)
    setCsvFileName(null)
    setCsvPreview(null)
  }

  function handleNewSession() {
    resetOrchestrator()
    setCsvFileName(null)
    setCsvPreview(null)
  }

  async function handleDeleteSession(id: string) {
    await session.deleteSession(id)
    if (sessionId === id) {
      handleNewSession()
    }
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
