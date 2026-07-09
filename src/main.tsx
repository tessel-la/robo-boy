import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import './index.css'

const roboBoyWindow = window as typeof window & {
  __ROBOBOY_APP_STARTED?: boolean
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

if (
  window.location.protocol === 'tauri:' ||
  roboBoyWindow.__TAURI__ ||
  roboBoyWindow.__TAURI_INTERNALS__
) {
  document.documentElement.setAttribute('data-runtime', 'tauri')
}

roboBoyWindow.__ROBOBOY_APP_STARTED = true

const rootElement = document.getElementById('root')

const renderBootError = (error: unknown) => {
  if (!rootElement) return

  const message = error instanceof Error ? error.message : String(error)
  rootElement.innerHTML = `
    <div style="
      min-height: 100vh;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #1f242d;
      color: #f5f7fb;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div style="
        max-width: 720px;
        width: 100%;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 16px;
        padding: 24px;
        background: rgba(255,255,255,0.08);
        box-shadow: 0 18px 50px rgba(0,0,0,0.35);
      ">
        <h1 style="margin: 0 0 12px; font-size: 24px;">Robo-Boy could not start</h1>
        <p style="margin: 0 0 16px; color: #cbd5e1;">
          The desktop shell loaded, but the frontend crashed before it could render.
        </p>
        <pre style="
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0;
          padding: 12px;
          border-radius: 8px;
          background: rgba(0,0,0,0.35);
          color: #fca5a5;
        ">${message}</pre>
      </div>
    </div>
  `
}

window.addEventListener('error', event => {
  renderBootError(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', event => {
  renderBootError(event.reason)
})

try {
  if (!rootElement) {
    throw new Error('Root element #root was not found.')
  }

  ReactDOM.createRoot(rootElement).render(
    // <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    // </React.StrictMode>,
  )
} catch (error) {
  renderBootError(error)
}
