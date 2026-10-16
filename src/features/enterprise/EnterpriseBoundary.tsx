import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import { brand, enterpriseEnabled, enterpriseOrigin } from './config';
import {
  EnterpriseUnavailable,
  unreachable,
  enterpriseFetch,
  enterpriseProviders,
  getEnterpriseSession,
  nativeSignIn,
  parseSession,
  setEnterpriseSession,
  type EnterpriseProvider,
  type EnterpriseSession,
} from './session';
import { isDesktopRuntime } from '../../runtime/runtimeConfig';
import { getDesktopBridge } from '../../runtime/desktopBridge';
import BrandMark from './BrandMark';
import SessionRenewal from './SessionRenewal';
import './enterprise.css';

const AccountContext = createContext<{ user: EnterpriseSession['user']; logout: () => Promise<void> } | null>(null);
export const useEnterpriseAccount = () => useContext(AccountContext);

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
  // Keyed by the session expiry it renews, so it lapses on its own once a new session arrives.
  const [renewal, setRenewal] = useState<{ expires: number; waiting: boolean; error: string } | null>(null);
  const [providers, setProviders] = useState<EnterpriseProvider[]>([]);
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
        }).catch(error => {
          if (error instanceof TypeError) throw unreachable();
          throw error;
        });
        if (controller.signal.aborted || checkedRevision !== revision.current) return;
        if (response.status === 401) {
          apply(null);
          setConfirmed(false);
        } else {
          if (!response.ok) throw new EnterpriseUnavailable('The sign-in service is unavailable. Try again.');
          const next = parseSession(await response.json());
          if (controller.signal.aborted || checkedRevision !== revision.current) return;
          if (isDesktopRuntime()) {
            const previous = getEnterpriseSession();
            if (!previous?.token || previous.user.id !== next.user.id) throw new Error('Sign in again to continue.');
            apply({ ...previous, ...next });
          } else {
            // A web renewal in another tab arrives here. A different employee must confirm before use.
            const previous = getEnterpriseSession();
            apply(next);
            if (!previous) setConfirmed(true);
            else if (previous.user.id !== next.user.id) setConfirmed(false);
          }
          setError('');
        }
      } catch (failure) {
        if (controller.signal.aborted || checkedRevision !== revision.current) return;
        // A brief outage must not unmount a live workspace or discard a native credential.
        // The gateway still enforces expiry and revocation on every request and socket.
        const kept = getEnterpriseSession();
        if ((timedOut || failure instanceof EnterpriseUnavailable) && kept && kept.expires > Date.now()) return;
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
    // Failure keeps the single company button; the gateway then offers its own chooser.
    enterpriseProviders(controller.signal)
      .then(list => !controller.signal.aborted && setProviders(list))
      .catch(() => {});
    const timer = setInterval(() => void check(), 10000);
    return () => {
      controller.abort();
      attempt.current?.abort();
      clearInterval(timer);
      setEnterpriseSession(null);
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;
  const login = async (provider?: string) => {
    signedOut.current = false;
    revision.current += 1;
    setError('');
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    try {
      if (!isDesktopRuntime()) {
        window.location.assign(
          enterpriseOrigin() + '/auth/login' + (provider ? '?provider=' + encodeURIComponent(provider) : '')
        );
        return;
      }
      setWorking(true);
      const next = await nativeSignIn(controller.signal, openSignInBrowser, provider);
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
  const renew = async () => {
    const expires = getEnterpriseSession()?.expires;
    if (!expires) return;
    if (!isDesktopRuntime()) {
      // A second tab keeps this workspace and its robot sockets running; the session check picks up the cookie.
      const tab = window.open(enterpriseOrigin() + '/auth/login?renew=1', '_blank');
      if (tab) {
        tab.opener = null;
        setRenewal({ expires, waiting: true, error: '' });
        return;
      }
      window.location.assign(enterpriseOrigin() + '/auth/login');
      return;
    }
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setRenewal({ expires, waiting: true, error: '' });
    try {
      const next = await nativeSignIn(controller.signal, openSignInBrowser);
      if (controller.signal.aborted) return;
      const previous = getEnterpriseSession();
      apply(next);
      if (previous?.user.id !== next.user.id) setConfirmed(false);
    } catch (failure) {
      if (attempt.current === controller && !controller.signal.aborted)
        setRenewal({
          expires,
          waiting: false,
          error: failure instanceof Error ? failure.message : 'Sign-in failed. Try again.',
        });
    }
  };
  const cancelRenewal = () => {
    if (isDesktopRuntime()) attempt.current?.abort();
    setRenewal(null);
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
  if (current && confirmed) {
    const pending = renewal?.expires === current.expires ? renewal : null;
    return (
      <AccountContext.Provider value={{ user: current.user, logout }}>
        {children}
        <SessionRenewal
          key={current.expires}
          expires={current.expires}
          waiting={Boolean(pending?.waiting)}
          error={pending?.error ?? ''}
          native={isDesktopRuntime()}
          onRenew={() => void renew()}
          onCancel={cancelRenewal}
        />
      </AccountContext.Provider>
    );
  }
  return (
    <main className="enterprise-login">
      <header className="enterprise-login-header">
        <span>Robot operations</span>
        <span>Powered by Robo-Boy</span>
      </header>
      <div className="enterprise-login-content">
        <section className="enterprise-login-card" aria-labelledby="enterprise-login-title">
          <BrandMark />
          <span className="enterprise-eyebrow">Your robotics workspace</span>
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
          ) : working || loggingOut || providers.length < 2 ? (
            <button
              className="enterprise-primary"
              type="button"
              disabled={working || loggingOut}
              onClick={() => void login(providers[0]?.id)}
            >
              {loggingOut
                ? 'Signing out…'
                : working
                  ? 'Waiting for sign-in…'
                  : `Sign in with ${providers[0]?.label ?? 'your company account'}`}
            </button>
          ) : (
            <div className="enterprise-providers">
              {providers.map((provider, index) => (
                <button
                  key={provider.id}
                  className={index === 0 ? 'enterprise-primary' : undefined}
                  type="button"
                  onClick={() => void login(provider.id)}
                >
                  Sign in with {provider.label}
                </button>
              ))}
            </div>
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
          <small>Secure company access</small>
        </section>
      </div>
      <footer className="enterprise-login-footer">One sign-in. Your robots, workspaces and tools.</footer>
    </main>
  );
}
