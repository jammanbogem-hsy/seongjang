import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { PlatformProvider } from './app/PlatformProvider'
import { RouterProvider, useLocation } from './app/router'
import './styles/global.css'
import './styles/google-workspace.css'

function RuntimeApp() {
  const { pathname } = useLocation()
  const app = <App />
  // The standalone ebook has no live product data. Avoid opening Auth,
  // Firestore, App Check and public-revision listeners for reading a PDF.
  if (pathname === '/ebook') return app
  return <PlatformProvider>{app}</PlatformProvider>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <RuntimeApp />
    </RouterProvider>
  </StrictMode>,
)
