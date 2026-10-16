import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EnterpriseBoundary from './EnterpriseBoundary';
import { getEnterpriseSession, setEnterpriseSession } from './session';

afterEach(() => {
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

describe('EnterpriseBoundary', () => {
  it('mounts the normal application without authentication requests when disabled', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(
      <EnterpriseBoundary>
        <div>Robot workspace</div>
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
        <div>Robot workspace</div>
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
      return <div>Robot workspace</div>;
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
        <div>Robot workspace</div>
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
        <div>Robot workspace</div>
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
        <div>Robot workspace</div>
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
