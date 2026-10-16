import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { brand, enterpriseEnabled, enterpriseOrigin } from './config';
import {
  enterpriseFetch,
  getEnterpriseSession,
  nativeSignIn,
  parseSession,
  setEnterpriseSession,
  type EnterpriseSession,
} from './session';
import { isDesktopRuntime } from '../../runtime/runtimeConfig';
import { getDesktopBridge } from '../../runtime/desktopBridge';
import BrandMark from './BrandMark';
import './enterprise.css';

export async function openSignInBrowser(url: string) {
  if (getDesktopBridge()?.openEnterpriseLogin) return getDesktopBridge()!.openEnterpriseLogin!(url);
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<void>('enterprise_open_login', { url });
  }
  throw new Error('Update the packaged app to use enterprise sign-in.');
}

export default function EnterpriseBoundary({ children }: { children: ReactNode }) {
  const enabled = enterpriseEnabled();
  const [current, setCurrent] = useState<EnterpriseSession | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [working, setWorking] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<AbortController>();
  const revision = useRef(0);
  const signedOut = useRef(false);
  const apply = (value: EnterpriseSession | null) => {
    revision.current += 1;
    setEnterpriseSession(value);
    setCurrent(value);
  };
  useEffect(() => {
    document.title = brand.name;
    if (!enabled) return;
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking || signedOut.current) return;
      checking = true;
      const checkedRevision = revision.current;
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        request.abort();
      }, 10000);
      try {
        const response = await enterpriseFetch(enterpriseOrigin() + '/auth/session', {
          signal: request.signal,
          cache: 'no-store',
        });
        if (controller.signal.aborted || checkedRevision !== revision.current) return;
        if (response.status === 401) {
          apply(null);
          setConfirmed(false);
        } else {
          if (!response.ok) throw new Error('The sign-in service is unavailable. Try again.');
          const next = parseSession(await response.json());
          if (controller.signal.aborted || checkedRevision !== revision.current) return;
          if (isDesktopRuntime()) {
            const previous = getEnterpriseSession();
            if (!previous?.token || previous.user.id !== next.user.id) throw new Error('Sign in again to continue.');
            apply({ ...previous, ...next });
          } else {
            apply(next);
            setConfirmed(true);
          }
          setError('');
        }
      } catch (failure) {
        if (controller.signal.aborted || checkedRevision !== revision.current) return;
        apply(null);
        setConfirmed(false);
        setError(
          timedOut
            ? 'The sign-in service did not respond. Try again.'
            : failure instanceof Error
              ? failure.message
              : 'Sign-in could not be checked. Try again.'
        );
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener('abort', abort);
        checking = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 10000);
    return () => {
      controller.abort();
      attempt.current?.abort();
      clearInterval(timer);
      setEnterpriseSession(null);
    };
  }, [enabled]);

  if (!enabled)
    return brand.name !== 'Robo-Boy' || brand.logo ? (
      <div className="enterprise-shell">
        <div className="enterprise-account">
          <BrandMark />
        </div>
        {children}
      </div>
    ) : (
      <>{children}</>
    );
  const login = async () => {
    signedOut.current = false;
    revision.current += 1;
    setError('');
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    try {
      if (!isDesktopRuntime()) {
        window.location.assign(enterpriseOrigin() + '/auth/login');
        return;
      }
      setWorking(true);
      const next = await nativeSignIn(controller.signal, openSignInBrowser);
      if (!controller.signal.aborted) {
        apply(next);
        setConfirmed(false);
      }
    } catch (failure) {
      if (attempt.current === controller && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Sign-in failed. Try again.');
    } finally {
      if (attempt.current === controller) setWorking(false);
    }
  };
  const logout = async () => {
    signedOut.current = true;
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setLoggingOut(true);
    const deadline = setTimeout(() => controller.abort(), 10000);
    const outgoing = enterpriseFetch(enterpriseOrigin() + '/auth/logout', {
      method: 'POST',
      signal: controller.signal,
    });
    apply(null);
    setConfirmed(false);
    try {
      if (!(await outgoing).ok) throw new Error('Server logout failed');
    } catch {
      setError('Signed out locally. The server session will expire automatically.');
    } finally {
      clearTimeout(deadline);
      setLoggingOut(false);
    }
  };
  if (current && confirmed)
    return (
      <div className="enterprise-shell">
        <div className="enterprise-account">
          <BrandMark />
          <span>{current.user.name}</span>
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
        {children}
      </div>
    );
  return (
    <main
      className="enterprise-login"
      style={{ '--enterprise-accent': brand.accent || 'var(--primary-color)' } as CSSProperties}
    >
      <section className="enterprise-login-card" aria-labelledby="enterprise-login-title">
        <BrandMark />
        <h1 id="enterprise-login-title">{brand.loginTitle}</h1>
        <p>{brand.loginMessage}</p>
        {error && (
          <p role="alert" className="enterprise-error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Checking sign-in…</p>
        ) : current ? (
          <>
            <p>
              Signed in as <strong>{current.user.name}</strong>.
            </p>
            <button className="enterprise-primary" type="button" onClick={() => setConfirmed(true)}>
              Continue as {current.user.name}
            </button>
            <button type="button" onClick={() => void logout()}>
              Use another account
            </button>
          </>
        ) : (
          <button
            className="enterprise-primary"
            type="button"
            disabled={working || loggingOut}
            onClick={() => void login()}
          >
            {loggingOut ? 'Signing out…' : working ? 'Waiting for sign-in…' : 'Sign in with your company account'}
          </button>
        )}
        {working && (
          <>
            <p role="status">Complete sign-in in your browser, then return here.</p>
            <button
              type="button"
              onClick={() => {
                attempt.current?.abort();
                setWorking(false);
              }}
            >
              Cancel sign-in
            </button>
          </>
        )}
        {brand.supportUrl && (
          <a href={brand.supportUrl} target="_blank" rel="noopener noreferrer">
            Contact support
          </a>
        )}
        <small>Powered by Robo-Boy</small>
      </section>
    </main>
  );
}
