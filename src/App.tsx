import { AppShell, ChatPanel } from '@boriskulakhmetov-aidigital/design-system'
import type { ChatMessage } from '@boriskulakhmetov-aidigital/design-system'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import './App.css'

const supabaseConfig = import.meta.env.VITE_SUPABASE_URL ? {
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  createClient: createClient as any,
} : undefined

// TODO: Replace with your app's sidebar component
function PlaceholderSidebar() {
  return (
    <aside style={{ width: 260, borderRight: '1px solid var(--border)', padding: 16 }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
        Replace this with your Sidebar component
      </p>
    </aside>
  )
}

interface AppProps {
  auth: {
    SignIn: any
    UserButton: any
    useAuth: any
  }
}

export default function App({ auth }: AppProps) {
  return (
    <AppShell
      appTitle="Campaign Performance Optimizer"
      activityLabel="Campaign"
      auth={auth}
      supabaseConfig={supabaseConfig}
      helpUrl="/help"
      sidebar={<PlaceholderSidebar />}
    >
      {({ supabase, authFetch, userStatus, isAdmin }) => (
        <MainContent authFetch={authFetch} />
      )}
    </AppShell>
  )
}

function MainContent({ authFetch }: { authFetch: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)

  async function handleSend(text: string) {
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setStreaming(true)

    // TODO: Wire up your orchestrator via SSE streaming
    // Example:
    // const res = await authFetch('/.netlify/functions/orchestrator', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ message: text }),
    // })

    // Placeholder response
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'This is a placeholder response. Wire up your orchestrator!',
      }])
      setStreaming(false)
    }, 1000)
  }

  return (
    <ChatPanel
      messages={messages}
      streaming={streaming}
      error={null}
      onSend={handleSend}
      welcomeIcon="&#128202;"
      welcomeTitle="Welcome to Campaign Performance Optimizer"
      welcomeDescription="Analyze and optimize your marketing campaign performance with AI-powered insights. Paste your campaign data or describe your campaign to get started."
      placeholder="Describe your campaign or paste performance data..."
    />
  )
}
