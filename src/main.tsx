import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, readTheme } from './lib/theme'

// Before the first render, not in an effect: an effect runs after paint, so a reader whose
// chosen theme is the opposite of their OS would get one frame of the wrong palette on every
// load. See src/lib/theme.ts for why the usual inline-script trick is not available here.
applyTheme(readTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
