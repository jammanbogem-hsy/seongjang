import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { PlatformProvider } from './app/PlatformProvider'
import { RouterProvider } from './app/router'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <PlatformProvider>
        <App />
      </PlatformProvider>
    </RouterProvider>
  </StrictMode>,
)
