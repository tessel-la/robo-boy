import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EnterpriseBoundary from './EnterpriseBoundary';
import EnterpriseAccount from './EnterpriseAccount';
import { getEnterpriseSession, setEnterpriseSession } from './session';

const carrier = window as typeof window & { roboBoyDesktop?: unknown };
afterEach(() => {
  delete carrier.roboBoyDesktop;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setEnterpriseSession(null);
  vi.useRealTimers();
});
const enable = () => {
  vi.stubEnv('VITE_ENTERPRISE_LOGIN', 'true');
  vi.stubEnv('VITE_ENTERPRISE_SERVER_URL', 'https://robot.example');
};
const user = () => ({ user: { id: 'alice', name: 'Alice Employee' }, expires: Date.now() + 60000 });
const expiring = (minutes: number, id = 'alice') => ({
  user: { id, name: id === 'alice' ? 'Alice Employee' : 'Bob Employee' },
  expires: Date.now() + minutes * 60000,
});
const handoff = 'h'.repeat(43);
/** A packaged app's gateway: each completed handoff issues the next scripted session. */
const nativeGateway = (...issued: ReturnType<typeof expiring>[]) => {
  let latest = issued[0];
  let count = 0;
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/auth/native/start'))
      return new Response(
        JSON.stringify({ id: handoff, browserUrl: 'https://robot.example/auth/login?native=' + handoff })
      );
    if (url.endsWith('/auth/native/poll')) {
      latest = issued[Math.min(count, issued.length - 1)];
      count += 1;
      return new Response(JSON.stringify({ ...latest, token: String(count).repeat(43), media: 'm'.repeat(43) }));
    }
    return new Response(JSON.stringify(latest));
  });
};
function TrackedWorkspace({ cleanup }: { cleanup: () => void }) {
  ReactUseEffect(() => cleanup, [cleanup]);
  return (
    <div>
      Robot workspace
      <EnterpriseAccount />
    </div>
  );
}

describe('EnterpriseBoundary', () => {
  it('mounts the normal application without authentication requests when disabled', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(
      <EnterpriseBoundary>
        <div>
          Robot workspace
          <EnterpriseAccount />
        </div>
      </EnterpriseBoundary>
    );
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps robot components unmounted until server authentication succeeds', async () => {
    enable();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(
      <EnterpriseBoundary>
        <div>
          Robot workspace
          <EnterpriseAccount />
        </div>
      </EnterpriseBoundary>
    );
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
    await screen.findByRole('button', { name: 'Sign in with your company account' });
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
  });
  it('shows authenticated identity, signs out on the server and unmounts robot connections', async () => {
    enable();
    const fetch = vi
      .fn()
      .mockImplementation(
        async (url: string) => new Response(JSON.stringify(url.endsWith('/auth/logout') ? {} : user()))
      );
    vi.stubGlobal('fetch', fetch);
    const cleanup = vi.fn();
    function Workspace() {
      ReactUseEffect(() => cleanup, []);
      return (
        <div>
          Robot workspace
          <EnterpriseAccount />
        </div>
      );
    }
    render(
      <EnterpriseBoundary>
        <Workspace />
      </EnterpriseBoundary>
    );
    await screen.findByText('Robot workspace');
    expect(screen.getByText('Alice Employee')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: 'Sign in with your company account' });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/auth/logout'))).toBe(true);
    expect(getEnterpriseSession()).toBeNull();
  });
  it('fails closed on service outages instead of exposing robot controls', async () => {
    enable();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Sign-in service unavailable.')));
    render(
      <EnterpriseBoundary>
        <div>
          Robot workspace
          <EnterpriseAccount />
        </div>
      </EnterpriseBoundary>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in service unavailable.');
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
  });
  it('removes the workspace when the server session expires', async () => {
    enable();
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(user())));
    vi.stubGlobal('fetch', fetch);
    render(
      <EnterpriseBoundary>
        <div>
          Robot workspace
          <EnterpriseAccount />
        </div>
      </EnterpriseBoundary>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
  });
  it('keeps a live workspace through brief network and gateway outages', async () => {
    enable();
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(user())));
    vi.stubGlobal('fetch', fetch);
    render(
      <EnterpriseBoundary>
        <div>Robot workspace</div>
      </EnterpriseBoundary>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    for (const outage of [
      () => Promise.reject(new TypeError('Failed to fetch')),
      async () => new Response('', { status: 502 }),
    ]) {
      fetch.mockImplementationOnce(outage);
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    }
    fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
  });
  it('explains an unreachable server before sign-in', async () => {
    enable();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(
      <EnterpriseBoundary>
        <div>Robot workspace</div>
      </EnterpriseBoundary>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach https://robot.example');
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
  });
  it('offers one button per sign-in provider and starts the chosen one', async () => {
    enable();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/providers')
          ? new Response(
              JSON.stringify({
                providers: [
                  { id: 'company', label: 'your company account' },
                  { id: 'google', label: 'Google' },
                  { id: 'microsoft', label: 'Microsoft' },
                ],
              })
            )
          : new Response('{}', { status: 401 })
      )
    );
    render(
      <EnterpriseBoundary>
        <div>Robot workspace</div>
      </EnterpriseBoundary>
    );
    await screen.findByRole('button', { name: 'Sign in with Microsoft' });
    expect(screen.getByRole('button', { name: 'Sign in with your company account' })).toHaveClass('enterprise-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(assign).toHaveBeenCalledWith('https://robot.example/auth/login?provider=google');
  });
  it('does not restore a signed-out workspace from a delayed session response', async () => {
    enable();
    vi.useFakeTimers();
    let resolveCheck!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(user())))
      .mockImplementationOnce(
        () =>
          new Promise<Response>(resolve => {
            resolveCheck = resolve;
          })
      )
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.endsWith('/auth/providers') ? Promise.resolve(new Response('', { status: 404 })) : fetch(url, init)
    );
    render(
      <EnterpriseBoundary>
        <div>
          Robot workspace
          <EnterpriseAccount />
        </div>
      </EnterpriseBoundary>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await act(async () => {
      await Promise.resolve();
      resolveCheck(new Response(JSON.stringify(user())));
    });
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
    expect(getEnterpriseSession()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('warns five minutes before expiry without covering or unmounting the workspace', async () => {
    enable();
    vi.useFakeTimers();
    const session = JSON.stringify(expiring(6));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(session))
    );
    const cleanup = vi.fn();
    render(
      <EnterpriseBoundary>
        <TrackedWorkspace cleanup={cleanup} />
      </EnterpriseBoundary>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Session expiry' })).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByRole('status', { name: 'Session expiry' })).toHaveTextContent('ends in 5 minutes');
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('status', { name: 'Session expiry' })).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(4 * 60000 + 1000);
    });
    expect(screen.getByRole('status', { name: 'Session expiry' })).toHaveTextContent('less than a minute');
    expect(cleanup).not.toHaveBeenCalled();
  });
  it('renews a web session in a second tab and keeps the same employee workspace mounted', async () => {
    enable();
    vi.useFakeTimers();
    const initial = JSON.stringify(expiring(4));
    const fetch = vi.fn().mockImplementation(async () => new Response(initial));
    vi.stubGlobal('fetch', fetch);
    const tab = { opener: window };
    const open = vi.fn().mockReturnValue(tab);
    vi.stubGlobal('open', open);
    const cleanup = vi.fn();
    render(
      <EnterpriseBoundary>
        <TrackedWorkspace cleanup={cleanup} />
      </EnterpriseBoundary>
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(open).toHaveBeenCalledWith('https://robot.example/auth/login?renew=1', '_blank');
    expect(tab.opener).toBeNull();
    expect(screen.getByRole('status', { name: 'Session expiry' })).toHaveTextContent('Complete sign-in in the new tab');
    const renewed = JSON.stringify(expiring(60));
    fetch.mockImplementation(async () => new Response(renewed));
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByRole('status', { name: 'Session expiry' })).not.toBeInTheDocument();
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    expect(cleanup).not.toHaveBeenCalled();
    expect(getEnterpriseSession()?.expires).toBeGreaterThan(Date.now() + 55 * 60000);
  });
  it('asks a different web employee to confirm before showing the workspace', async () => {
    enable();
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(expiring(4))));
    vi.stubGlobal('fetch', fetch);
    const cleanup = vi.fn();
    render(
      <EnterpriseBoundary>
        <TrackedWorkspace cleanup={cleanup} />
      </EnterpriseBoundary>
    );
    await act(async () => {
      await Promise.resolve();
    });
    fetch.mockImplementation(async () => new Response(JSON.stringify(expiring(60, 'bob'))));
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Continue as Bob Employee' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
  });
  it('swaps in a renewed native session without unmounting the workspace', async () => {
    enable();
    const openEnterpriseLogin = vi.fn().mockResolvedValue(undefined);
    carrier.roboBoyDesktop = { openEnterpriseLogin };
    const fetch = nativeGateway(expiring(4), expiring(60));
    vi.stubGlobal('fetch', fetch);
    const cleanup = vi.fn();
    render(
      <EnterpriseBoundary>
        <TrackedWorkspace cleanup={cleanup} />
      </EnterpriseBoundary>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your company account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue as Alice Employee' }));
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    expect(getEnterpriseSession()?.token).toBe('1'.repeat(43));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Session expiry' })).not.toBeInTheDocument());
    expect(openEnterpriseLogin).toHaveBeenCalledTimes(2);
    const renewal = fetch.mock.calls.filter(([url]) => url.endsWith('/auth/native/start'))[1][1];
    expect(renewal?.headers).toMatchObject({ 'X-RoboBoy-Session': '1'.repeat(43) });
    expect(getEnterpriseSession()?.token).toBe('2'.repeat(43));
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    expect(cleanup).not.toHaveBeenCalled();
  });
  it('requires confirmation when a native renewal signs in a different employee', async () => {
    enable();
    carrier.roboBoyDesktop = { openEnterpriseLogin: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('fetch', nativeGateway(expiring(4), expiring(60, 'bob')));
    const cleanup = vi.fn();
    render(
      <EnterpriseBoundary>
        <TrackedWorkspace cleanup={cleanup} />
      </EnterpriseBoundary>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your company account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue as Alice Employee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await screen.findByRole('button', { name: 'Continue as Bob Employee' });
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('reports a failed native renewal and keeps the workspace until the gateway ends it', async () => {
    enable();
    carrier.roboBoyDesktop = { openEnterpriseLogin: vi.fn().mockResolvedValue(undefined) };
    const fetch = nativeGateway(expiring(4));
    vi.stubGlobal('fetch', fetch);
    render(
      <EnterpriseBoundary>
        <TrackedWorkspace cleanup={vi.fn()} />
      </EnterpriseBoundary>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your company account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue as Alice Employee' }));
    fetch.mockImplementation(async (url: string) =>
      url.endsWith('/auth/native/start')
        ? new Response(
            JSON.stringify({ id: handoff, browserUrl: 'https://robot.example/auth/login?native=' + handoff })
          )
        : new Response('{}', { status: 401 })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in expired or was rejected');
    expect(screen.getByText('Robot workspace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
  });
  it('times out a stalled session check while keeping robot components unmounted', async () => {
    enable();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
          })
      )
    );
    render(
      <EnterpriseBoundary>
        <div>
          Robot workspace
          <EnterpriseAccount />
        </div>
      </EnterpriseBoundary>
    );
    await act(async () => {
      vi.advanceTimersByTime(10001);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('did not respond');
    expect(screen.queryByText('Robot workspace')).not.toBeInTheDocument();
  });
});
import { useEffect as ReactUseEffect } from 'react';
