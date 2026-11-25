import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import { applyPrefs } from './lib/prefs'
import { desktopMac } from './lib/desktop'

applyPrefs()
// Inside the desktop app on a Mac the page draws the title bar (styles/index.css makes room).
if (desktopMac) document.documentElement.dataset.desktop = 'mac'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
