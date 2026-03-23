import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, SignIn, UserButton, useAuth } from '@clerk/react'
import { applyTheme, resolveTheme } from '@boriskulakhmetov-aidigital/design-system'
import '@boriskulakhmetov-aidigital/design-system/style.css'
import App from './App'
import './index.css'

applyTheme(resolveTheme())

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string
const isEmbed = window.location.pathname === '/embed'
const isHelpPage = window.location.pathname === '/help'

if (isEmbed) {
  // Embed route — no ClerkProvider, no auth
  const params = new URLSearchParams(window.location.search)
  const embedToken = params.get('token')
  if (embedToken) {
    // TODO: Create src/pages/EmbedPage.tsx for your app's embed widget
    // import('./pages/EmbedPage').then(({ default: Embed }) => {
    //   ReactDOM.createRoot(document.getElementById('root')!).render(
    //     <React.StrictMode>
    //       <Embed token={embedToken} theme={params.get('theme') || undefined} />
    //     </React.StrictMode>
    //   )
    // })
    console.warn('Embed page not yet implemented — create src/pages/EmbedPage.tsx')
  }
} else if (isHelpPage) {
  import('./pages/HelpPage').then(({ default: Help }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><Help /></React.StrictMode>
    )
  })
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={clerkKey}>
        <App auth={{ SignIn, UserButton, useAuth }} />
      </ClerkProvider>
    </React.StrictMode>
  )
}
