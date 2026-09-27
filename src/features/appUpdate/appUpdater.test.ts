import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdater } from '../../runtime/desktopUpdater';
import { AppUpdater } from './appUpdater';
import { APP_VERSION, releaseTag } from './releases';

const NEXT = '99.0.0';
const DIGEST = 'b'.repeat(64);
const TARGET = { shell: 'electron', os: 'linux', arch: 'x64', package: 'deb' } as const;
const release = (version = NEXT) => ({
  tag_name: releaseTag(version), name: `robo-boy: v${version}`, body: '### Features\n\n* **replay:** remote bags', published_at: '2026-09-27T10:00:00Z',
  html_url: `https://github.com/tessel-la/robo-boy/releases/tag/${releaseTag(version)}`,
  assets: [{ name: 'Robo-Boy-linux-amd64-electron.deb', browser_download_url: 'https://github.com/x', size: 1000, digest: `sha256:${DIGEST}` }],
});

/** GitHub: the release list, and a comparison listing `changed`. */
const githubWith = (releases: unknown[], changed: string[] = []) =>
  vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(String(input).includes('/compare/') ? { files: changed.map(filename => ({ filename })) } : releases))) as unknown as typeof fetch;

function fakeShell(overrides: Partial<DesktopUpdater> = {}): DesktopUpdater {
  return {
    target: vi.fn(async () => TARGET),
    download: vi.fn(async (_asset, onProgress) => { onProgress(400, 1000); onProgress(1000, 1000); }),
    cancel: vi.fn(async () => undefined),
    install: vi.fn(() => new Promise<void>(() => undefined)), // The app restarts; it never answers.
    openInstaller: vi.fn(async () => undefined),
    openReleasePage: vi.fn(async () => undefined),
    ...overrides,
  };
}

let storage: Map<string, string>;
const store = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key) };
const make = (shell: DesktopUpdater | null, fetcher: typeof fetch) => new AppUpdater({ getUpdater: async () => shell, fetch: fetcher, storage: store });
const settle = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); storage = new Map(); });
afterEach(() => { vi.useRealTimers(); });

describe('AppUpdater', () => {
  it('stays quiet where the app cannot update itself', async () => {
    const fetcher = githubWith([release()]);
    for (const shell of [null, fakeShell({ target: vi.fn(async () => null) })]) {
      const updater = make(shell, fetcher);
      await updater.start();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(updater.snapshot).toMatchObject({ supported: false, phase: 'idle', promptOpen: false });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks shortly after launch and offers a newer release with its installer and what it does to the ROS stack', async () => {
    const updater = make(fakeShell(), githubWith([release()], ['infra/ros/recording_runner.py', 'src/App.tsx']));
    await updater.start();
    expect(updater.snapshot.supported).toBe(true);
    await vi.advanceTimersByTimeAsync(4000);
    await settle();
    expect(updater.snapshot).toMatchObject({ phase: 'available', promptOpen: true, release: { version: NEXT }, installer: { name: 'Robo-Boy-linux-amd64-electron.deb' }, rosStack: ['infra/ros/recording_runner.py'] });
    updater.dispose();
  });

  it('says so when it is up to date, and keeps automatic failures to itself', async () => {
    const current = make(fakeShell(), githubWith([release(APP_VERSION)]));
    await current.start();
    await current.check(true);
    expect(current.snapshot).toMatchObject({ phase: 'current', promptOpen: false });

    const offline = make(fakeShell(), vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch);
    await offline.start();
    await offline.check();
    expect(offline.snapshot).toMatchObject({ phase: 'idle', promptOpen: false, error: undefined });
    await offline.check(true);
    expect(offline.snapshot).toMatchObject({ phase: 'failed', promptOpen: true, error: 'GitHub could not be reached to check for updates.' });
    current.dispose(); offline.dispose();
  });

  it('keeps a skipped or postponed version to the menu, until someone asks', async () => {
    const updater = make(fakeShell(), githubWith([release()]));
    await updater.start();
    await updater.check();
    updater.later();
    await updater.check();
    expect(updater.snapshot).toMatchObject({ phase: 'available', promptOpen: false });
    updater.skip();
    expect(storage.get('roboboy-update-skipped-version')).toBe(NEXT);
    const again = make(fakeShell(), githubWith([release()]));
    await again.start();
    await again.check();
    expect(again.snapshot.promptOpen).toBe(false);
    again.open();
    expect(again.snapshot.promptOpen).toBe(true);
    updater.dispose(); again.dispose();
  });

  it('downloads with progress, installs, and leaves a ROS stack reminder for the version it restarts into', async () => {
    const shell = fakeShell();
    const updater = make(shell, githubWith([release()], ['docker-compose.yml']));
    await updater.start();
    await updater.check();
    const seen: number[] = [];
    updater.subscribe(() => { if (updater.snapshot.progress) seen.push(updater.snapshot.progress.received); });
    void updater.install();
    await settle();
    expect(shell.download).toHaveBeenCalledWith({ tag: releaseTag(NEXT), name: 'Robo-Boy-linux-amd64-electron.deb' }, expect.any(Function));
    expect(seen).toEqual(expect.arrayContaining([0, 400, 1000]));
    expect(updater.snapshot).toMatchObject({ phase: 'installing', downloaded: true });
    expect(shell.install).toHaveBeenCalled();
    expect(JSON.parse(storage.get('roboboy-ros-stack-update')!)).toEqual({ from: APP_VERSION, to: NEXT, files: ['docker-compose.yml'] });
    updater.dispose();
  });

  it('reports a failed download or install, and offers the checked installer when installing fails', async () => {
    const shell = fakeShell({ download: vi.fn(async () => { throw new Error("Error invoking remote method 'roboboy:update-download': Error: The download does not match the release."); }) });
    const updater = make(shell, githubWith([release()]));
    await updater.start();
    await updater.check();
    await updater.install();
    expect(updater.snapshot).toMatchObject({ phase: 'failed', downloaded: false, error: 'The download does not match the release.' });

    shell.download = vi.fn(async () => undefined);
    shell.install = vi.fn(async () => { throw 'Installing needs administrator approval, and it was not given.'; });
    await updater.install();
    expect(updater.snapshot).toMatchObject({ phase: 'failed', downloaded: true, error: 'Installing needs administrator approval, and it was not given.' });
    await updater.openInstaller();
    expect(shell.openInstaller).toHaveBeenCalled();
    await updater.openReleasePage();
    expect(shell.openReleasePage).toHaveBeenCalledWith(releaseTag(NEXT));
    updater.dispose();
  });

  it('cancels a download back to the offer', async () => {
    let fail: (error: Error) => void = () => undefined;
    const shell = fakeShell({ download: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })) });
    const updater = make(shell, githubWith([release()]));
    await updater.start();
    await updater.check();
    const installing = updater.install();
    await settle();
    await updater.cancel();
    fail(new Error('The download was cancelled.'));
    await installing;
    expect(shell.cancel).toHaveBeenCalled();
    expect(updater.snapshot).toMatchObject({ phase: 'available', error: undefined });
    updater.dispose();
  });

  it('reminds about the ROS stack after the update it belongs to, until it is done', async () => {
    storage.set('roboboy-ros-stack-update', JSON.stringify({ from: '0.1.0', to: APP_VERSION, files: ['infra/ros/recording_runner.py'] }));
    const updater = make(null, githubWith([]));
    await updater.start();
    expect(updater.snapshot.rosReminder).toEqual({ from: '0.1.0', to: APP_VERSION, files: ['infra/ros/recording_runner.py'] });
    updater.dismissRosReminder(false);
    expect(storage.has('roboboy-ros-stack-update')).toBe(true);
    updater.dismissRosReminder(true);
    expect(storage.has('roboboy-ros-stack-update')).toBe(false);

    // One left from an update that has since been superseded is dropped.
    storage.set('roboboy-ros-stack-update', JSON.stringify({ from: '0.0.1', to: '0.0.2', files: [] }));
    await make(null, githubWith([])).start();
    expect(storage.has('roboboy-ros-stack-update')).toBe(false);
  });
});
