import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { initTheme } from './lib/theme'

initTheme()

// Strip trailing slash off Vite's BASE_URL so React Router's basename matches
// (e.g. '/hashio-crm/' → '/hashio-crm'; '/' → undefined).
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
