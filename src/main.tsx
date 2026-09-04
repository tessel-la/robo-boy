import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { isMobilePlatform } from './runtime/runtimeConfig.tsx';
import './index.css';

const roboBoyWindow = window as typeof window & {
  __ROBOBOY_APP_STARTED?: boolean;
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

if (window.location.protocol === 'tauri:' || roboBoyWindow.__TAURI__ || roboBoyWindow.__TAURI_INTERNALS__) {
  document.documentElement.setAttribute('data-runtime', 'tauri');

  // A desktop window is undecorated and leaves its chrome to the app; a phone draws its own bars
  // around the app instead. The stylesheet needs that apart before React mounts, so that the app
  // never lays out under a title bar that is not there.
  if (isMobilePlatform()) {
    document.documentElement.setAttribute('data-shell', 'mobile');

    // `env(safe-area-inset-*)` only reports the room the system bars take once the page has asked
    // for the whole screen.
    const viewport = document.querySelector('meta[name="viewport"]');
    const content = viewport?.getAttribute('content');
    if (viewport && content && !content.includes('viewport-fit')) {
      viewport.setAttribute('content', `${content}, viewport-fit=cover`);
    }
  }
}

roboBoyWindow.__ROBOBOY_APP_STARTED = true;

const rootElement = document.getElementById('root');
let isBooting = true;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const isIgnorableRuntimeError = (error: unknown) => {
  const message = getErrorMessage(error);
  return (
    message.includes('ResizeObserver loop completed with undelivered notifications') ||
    message.includes('ResizeObserver loop limit exceeded')
  );
};

const createElementWithStyles = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  styles: Record<string, string>,
  textContent?: string
) => {
  const element = document.createElement(tagName);
  Object.assign(element.style, styles);
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  return element;
};

const renderBootError = (error: unknown) => {
  if (!rootElement) return;

  const wrapper = createElementWithStyles('div', {
    minHeight: '100vh',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: '#1f242d',
    color: '#f5f7fb',
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });
  const panel = createElementWithStyles('div', {
    maxWidth: '720px',
    width: '100%',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '16px',
    padding: '24px',
    background: 'rgba(255,255,255,0.08)',
    boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
  });
  const title = createElementWithStyles('h1', { margin: '0 0 12px', fontSize: '24px' }, 'Robo-Boy could not start');
  const description = createElementWithStyles(
    'p',
    { margin: '0 0 16px', color: '#cbd5e1' },
    'The desktop shell loaded, but the frontend crashed before it could render.'
  );
  const details = createElementWithStyles(
    'pre',
    {
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      margin: '0',
      padding: '12px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,0.35)',
      color: '#fca5a5',
    },
    getErrorMessage(error)
  );

  panel.append(title, description, details);
  wrapper.append(panel);
  rootElement.replaceChildren(wrapper);
};

window.addEventListener('error', event => {
  if (isIgnorableRuntimeError(event.error ?? event.message)) {
    event.preventDefault();
    return;
  }
  if (isBooting) {
    renderBootError(event.error ?? event.message);
  } else {
    console.error('[runtime error]', event.error ?? event.message);
  }
});

window.addEventListener('unhandledrejection', event => {
  if (isIgnorableRuntimeError(event.reason)) {
    event.preventDefault();
    return;
  }
  if (isBooting) {
    renderBootError(event.reason);
  } else {
    console.error('[unhandled rejection]', event.reason);
  }
});

try {
  if (!rootElement) {
    throw new Error('Root element #root was not found.');
  }

  ReactDOM.createRoot(rootElement).render(
    // <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    // </React.StrictMode>,
  );
  isBooting = false;
} catch (error) {
  isBooting = false;
  renderBootError(error);
}
