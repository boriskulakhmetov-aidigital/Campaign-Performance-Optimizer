import {
  AppShell,
  ChatPanel,
  UploadZone,
  Spinner,
  useJobStatus,
  VisualizingIndicator,
  KpiTile,
  ScorePill,
  SeverityBadge,
  ActionCard,
  SectionDivider,
  ReportLayout,
  PageHeader,
  ReportTable,
  ProgressBar,
} from '@boriskulakhmetov-aidigital/design-system'
import type { ChatMessage } from '@boriskulakhmetov-aidigital/design-system'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@clerk/react'
import { useOrchestrator } from './hooks/useOrchestrator'
import { parseGoogleAdsCsv } from './lib/csv-parser'
import CampaignSidebar from './components/CampaignSidebar'
import type { CpoReportData, CampaignSummary, ParsedCsvResult } from './lib/types'
import './App.css'

const supabaseConfig = import.meta.env.VITE_SUPABASE_URL ? {
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  createClient: createClient as any,
} : undefined

type Phase = 'chat' | 'analyzing' | 'optimizing' | 'report'

interface AppProps {
  auth: { SignIn: any; UserButton: any; useAuth: any }
}

export default function App({ auth }: AppProps) {
  const { getToken } = useAuth()

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
      {({ supabase, authFetch }) => (
        <AppContent
          supabase={supabase}
          authFetch={authFetch}
          handlersRef={handlersRef}
          setSidebarSupabase={setSidebarSupabase}
          sidebarRefreshKey={sidebarRefreshKey}
          setSidebarRefreshKey={setSidebarRefreshKey}
          currentSessionId={currentSessionId}
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
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  handlersRef: React.MutableRefObject<{
    onSelectSession: (id: string) => void
    onNewSession: () => void
    onDeleteSession: (id: string) => void
  }>
  setSidebarSupabase: (sb: SupabaseClient | null) => void
  sidebarRefreshKey: number
  setSidebarRefreshKey: React.Dispatch<React.SetStateAction<number>>
  currentSessionId: string | null
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setLoadingSessionId: React.Dispatch<React.SetStateAction<string | null>>
}

function AppContent({
  supabase,
  authFetch,
  handlersRef,
  setSidebarSupabase,
  setSidebarRefreshKey,
  setCurrentSessionId,
  setLoadingSessionId,
}: AppContentProps) {
  const { getToken } = useAuth()

  const [phase, setPhase] = useState<Phase>('chat')
  const [jobId, setJobId] = useState<string | null>(null)
  const [reportData, setReportData] = useState<CpoReportData | null>(null)
  const [reportMarkdown, setReportMarkdown] = useState('')
  const [reportFormat, setReportFormat] = useState<'visual' | 'markdown'>('visual')
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<ParsedCsvResult | null>(null)
  const [campaignId, setCampaignId] = useState<string | null>(null)

  // Expose supabase to sidebar
  useEffect(() => { setSidebarSupabase(supabase) }, [supabase, setSidebarSupabase])

  // Orchestrator
  const refreshSidebar = useCallback(() => setSidebarRefreshKey(k => k + 1), [setSidebarRefreshKey])

  const handleDispatch = useCallback(async (
    config: any,
    sessionId: string,
    messages: ChatMessage[],
  ) => {
    setPhase('analyzing')
    const newJobId = crypto.randomUUID()
    setJobId(newJobId)
    setCurrentSessionId(sessionId)

    // Kick off analysis background agent
    const token = await getToken()
    const res = await fetch('/.netlify/functions/analyze-background', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jobId: newJobId,
        sessionId,
        analysisConfig: config,
      }),
    })

    if (!res.ok) {
      setPhase('chat')
    }
  }, [getToken, setCurrentSessionId])

  const {
    messages, streaming, error: chatError,
    sendMessage, setCsvText, reset: resetOrchestrator, loadSession, sessionId,
  } = useOrchestrator(handleDispatch, supabase, refreshSidebar)

  // Watch job status for analysis completion
  const jobStatus = useJobStatus(supabase, jobId)

  useEffect(() => {
    if (!jobStatus) return
    const jobPhase = (jobStatus as any).meta?.phase as string | undefined

    if (jobStatus.status === 'complete' && phase === 'analyzing') {
      // Analysis done — load report data and trigger optimization
      if (supabase && sessionId) {
        supabase.from('cpo_sessions')
          .select('report_data, report')
          .eq('id', sessionId)
          .single()
          .then(({ data }) => {
            if (data?.report_data) {
              setReportData(data.report_data)
              setReportMarkdown(data.report || '')
              handleOptimize(data.report_data)
            }
          })
      }
    }
    if (jobStatus.status === 'complete' && phase === 'optimizing') {
      // Optimization done — show report
      if (supabase && sessionId) {
        supabase.from('cpo_sessions')
          .select('report_data')
          .eq('id', sessionId)
          .single()
          .then(({ data }) => {
            if (data?.report_data) {
              setReportData(data.report_data)
              setPhase('report')
              refreshSidebar()
            }
          })
      }
    }
    if (jobStatus.status === 'error') {
      setPhase('chat')
    }
  }, [jobStatus?.status, phase])

  async function handleOptimize(analysisData: any) {
    setPhase('optimizing')
    const optimizeJobId = crypto.randomUUID()
    setJobId(optimizeJobId)

    // Find the campaign ID from DB
    let cId = campaignId
    if (!cId && supabase) {
      const { data } = await supabase
        .from('cpo_campaigns')
        .select('id')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      cId = data?.id || null
      setCampaignId(cId)
    }

    const token = await getToken()
    await fetch('/.netlify/functions/optimize-background', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jobId: optimizeJobId,
        sessionId,
        campaignId: cId,
        analysisData,
      }),
    })
  }

  // CSV file handler — parses and stages the file, user sends the message
  function handleCsvFile(file: File) {
    setCsvFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setCsvText(text)
      const result = parseGoogleAdsCsv(text)
      setCsvPreview(result)

      // Auto-send with summary so the orchestrator gets context immediately
      if (result.errors.length === 0) {
        sendMessage(
          `I've uploaded a Google Ads CSV file "${file.name}" with ${result.totalAds} ads across ${result.campaigns.length} campaign(s). Total spend: $${result.totalSpend.toFixed(2)}. Please analyze this data.`
        )
      } else {
        sendMessage(
          `I've uploaded "${file.name}". ${result.errors.join('. ')}. Here's the raw data — please try to parse and analyze it.`
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

      if (session.report_data) {
        setReportData(session.report_data)
        setPhase('report')
      } else {
        setReportData(null)
        setPhase('chat')
      }
    } finally {
      setLoadingSessionId(null)
    }
  }

  function handleNewSession() {
    resetOrchestrator()
    setPhase('chat')
    setJobId(null)
    setReportData(null)
    setReportMarkdown('')
    setCsvFileName(null)
    setCsvPreview(null)
    setCampaignId(null)
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

  // ── Render ────────────────────────────────────────────────────────

  if (phase === 'analyzing') {
    return (
      <VisualizingIndicator
        brandName={reportData?.campaign?.name || 'your campaign'}
        title="Analyzing Campaign Performance..."
        steps={[
          'Parsing campaign data',
          'Benchmarking metrics',
          'Scoring ad performance',
          'Identifying underperformers',
        ]}
        thresholds={[10, 30, 50, 70]}
      />
    )
  }

  if (phase === 'optimizing') {
    return (
      <VisualizingIndicator
        brandName={reportData?.campaign?.name || 'your campaign'}
        title="Generating Optimized Variations..."
        steps={[
          'Reviewing underperformers',
          'Applying copywriting techniques',
          'Generating headline variations',
          'Generating description variations',
          'Compiling optimization report',
        ]}
        thresholds={[5, 20, 40, 55, 70]}
      />
    )
  }

  if (phase === 'report' && reportData) {
    return (
      <ReportLayout
        reportData={reportData}
        reportText={reportMarkdown}
        reportFormat={reportFormat}
        onFormatChange={setReportFormat}
        onNewSession={handleNewSession}
        newButtonLabel="New Campaign"
        downloadTitle={reportData.campaign?.name || 'Campaign Report'}
      >
        <CampaignReport data={reportData} />
      </ReportLayout>
    )
  }

  // Default: chat phase
  return (
    <div className="cpo-chat-layout">
      <ChatPanel
        messages={messages}
        streaming={streaming}
        error={chatError}
        onSend={sendMessage}
        welcomeIcon="&#128202;"
        welcomeTitle="Campaign Performance Optimizer"
        welcomeDescription="Upload your Google Ads CSV or paste campaign data to analyze performance and generate optimized ad variations."
        placeholder="Describe your campaign or paste performance data..."
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

/* ── Campaign Report (Micro-Report) ──────────────────────────────── */

function CampaignReport({ data }: { data: CpoReportData }) {
  const { campaign, ads = [], variations = [], summary } = data

  const underperformers = ads.filter((a: any) => a.isUnderperformer || a.is_underperformer)
  const topPerformers = ads
    .filter((a: any) => !(a.isUnderperformer || a.is_underperformer))
    .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)

  return (
    <div className="mr-page">
      <PageHeader
        title={campaign?.name || 'Campaign Analysis'}
        subtitle={`${campaign?.platform || 'google_search'} · ${campaign?.objective || 'conversions'} · ${campaign?.vertical || ''}`}
      />

      {/* KPI Row */}
      {summary && (
        <>
          <div className="mr-kpi-row">
            <KpiTile label="Total Ads" value={summary.totalAds || ads.length} />
            <KpiTile label="Impressions" value={(summary.totalImpressions || 0).toLocaleString()} />
            <KpiTile label="Clicks" value={(summary.totalClicks || 0).toLocaleString()} />
            <KpiTile label="Conversions" value={summary.totalConversions || 0} />
            <KpiTile label="Spend" value={`$${(summary.totalSpend || 0).toFixed(2)}`} />
            <KpiTile label="Avg CTR" value={((summary.avgCtr || 0) * 100).toFixed(2)} suffix="%" />
            <KpiTile label="Avg CPC" value={`$${(summary.avgCpc || 0).toFixed(2)}`} />
          </div>

          <div className="mr-kpi-row mr-kpi-row--highlight">
            <KpiTile
              label="Underperformers"
              value={summary.underperformerCount || underperformers.length}
              color="var(--danger, #ef4444)"
            />
            <KpiTile
              label="Variations Generated"
              value={summary.variationsGenerated || variations.length}
              color="var(--accent)"
            />
          </div>
        </>
      )}

      {/* Underperformers */}
      {underperformers.length > 0 && (
        <>
          <SectionDivider label={`Underperforming Ads (${underperformers.length})`} />
          <div className="mr-actions-grid">
            {underperformers.map((ad: any, i: number) => (
              <ActionCard
                key={ad.id || i}
                title={ad.headline || `Ad ${i + 1}`}
                description={ad.description || ''}
                badge={<SeverityBadge severity={ad.score < 3 ? 'critical' : ad.score < 5 ? 'significant' : 'moderate'} />}
                score={<ScorePill score={ad.score || 0} max={10} />}
                meta={
                  <span>
                    {ad.adGroup || ad.ad_group} · CTR {((ad.ctr || 0) * 100).toFixed(2)}% · CPC ${(ad.cpc || 0).toFixed(2)}
                  </span>
                }
              >
                {ad.scoreReasons && (
                  <div className="mr-score-reasons">
                    {(ad.scoreReasons || ad.score_reasons || []).map((r: any, j: number) => (
                      <span key={j} className={`mr-reason mr-reason--${r.verdict}`}>
                        {r.metric}: {typeof r.value === 'number' ? (r.value * 100).toFixed(2) : r.value}%
                        vs {typeof r.benchmark === 'number' ? (r.benchmark * 100).toFixed(2) : r.benchmark}% benchmark
                      </span>
                    ))}
                  </div>
                )}
              </ActionCard>
            ))}
          </div>
        </>
      )}

      {/* Suggested Variations */}
      {variations.length > 0 && (
        <>
          <SectionDivider label={`Suggested Variations (${variations.length})`} />
          <div className="mr-actions-grid">
            {variations.map((v: any, i: number) => (
              <ActionCard
                key={v.id || i}
                title={v.headline || v.originalHeadline || `Variation ${i + 1}`}
                description={v.description || v.originalDescription || ''}
                badge={
                  <span className="mr-techniques">
                    {(v.techniques || []).map((t: string) => (
                      <span key={t} className="mr-technique-tag">{t.replace(/_/g, ' ')}</span>
                    ))}
                  </span>
                }
                meta={
                  <span>
                    {v.changeType || v.change_type} · {v.adGroup || v.ad_group || ''}
                  </span>
                }
              >
                {v.rationale && (
                  <p className="mr-rationale">{v.rationale}</p>
                )}
              </ActionCard>
            ))}
          </div>
        </>
      )}

      {/* Top Performers */}
      {topPerformers.length > 0 && (
        <>
          <SectionDivider label={`Top Performers (${topPerformers.length})`} />
          <div className="mr-actions-grid">
            {topPerformers.map((ad: any, i: number) => (
              <ActionCard
                key={ad.id || i}
                title={ad.headline || `Ad ${i + 1}`}
                description={ad.description || ''}
                score={<ScorePill score={ad.score || 0} max={10} />}
                meta={
                  <span>
                    {ad.adGroup || ad.ad_group} · CTR {((ad.ctr || 0) * 100).toFixed(2)}% · CPC ${(ad.cpc || 0).toFixed(2)}
                  </span>
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
