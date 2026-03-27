import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

/*
  The service worker lets the app cache core files after the first visit so the
  installed app can open again with limited or no connection.
*/
function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('Service worker registered:', registration.scope)
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error)
      })
  })
}

registerServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
