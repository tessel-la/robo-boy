import { useSyncExternalStore } from 'react';
import { getDesktopUpdater, type DesktopUpdater } from '../../runtime/desktopUpdater';
import { APP_VERSION, fetchLatestRelease, installerFor, isNewer, rosStackChangesBetween, type AppRelease, type ReleaseAsset, type UpdateTarget } from './releases';

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'failed';

/** After an update that changed the ROS stack, what the ROS host still needs. */
export interface RosStackReminder {
  from: string;
  to: string;
  files: string[];
}

export interface UpdateSnapshot {
  phase: UpdatePhase;
  /** Whether this copy can update itself: false in a development build, null until the shell answered. */
  supported: boolean | null;
  current: string;
  release?: AppRelease;
  /** The installer for this installation; absent when the release has none, and the page link stands in. */
  installer?: ReleaseAsset;
  /** ROS-stack files the release changes; null when that cannot be told. */
  rosStack?: string[] | null;
  progress?: { received: number; total: number };
  error?: string;
  /** A checked installer is on disk, so the system's installer can still be offered. */
  downloaded: boolean;
  promptOpen: boolean;
  /** The last check found nothing newer; shown by the menu for a check someone asked for. */
  checkedAt?: number;
  rosReminder?: RosStackReminder;
}

const SKIPPED_KEY = 'roboboy-update-skipped-version';
const ROS_REMINDER_KEY = 'roboboy-ros-stack-update';
const FIRST_CHECK_MS = 4000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

interface Dependencies {
  getUpdater: () => Promise<DesktopUpdater | null>;
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => number;
}

/**
 * The app's side of an update: when to look, what to offer, and what the person decided. The
 * shell's updater does the downloading and installing.
 */
export class AppUpdater {
  snapshot: UpdateSnapshot = { phase: 'idle', supported: null, current: APP_VERSION, downloaded: false, promptOpen: false };
  private listeners = new Set<() => void>();
  private updater: DesktopUpdater | null = null;
  private target: UpdateTarget | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private snoozed = new Set<string>();
  private started = false;

  constructor(private deps: Dependencies) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<UpdateSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }

  private read(key: string) { try { return this.deps.storage?.getItem(key) ?? null; } catch { return null; } }
  private write(key: string, value: string | null) {
    try { if (value === null) this.deps.storage?.removeItem(key); else this.deps.storage?.setItem(key, value); } catch { /* Private windows refuse storage; updates still work. */ }
  }

  /** Ask the shell whether this copy can update itself, then check shortly and every few hours. */
  async start() {
    if (this.started) return;
    this.started = true;
    this.update({ rosReminder: this.pendingRosReminder() });
    try {
      this.updater = await this.deps.getUpdater();
      this.target = (await this.updater?.target()) ?? null;
    } catch {
      this.target = null;
    }
    this.update({ supported: Boolean(this.target) });
    if (!this.target) return;
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_MS));
    this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS));
  }

  dispose() { this.timers.forEach(timer => clearTimeout(timer)); this.timers = []; this.started = false; }

  /** Look for a newer release. A check someone asked for always shows what it found. */
  async check(asked = false) {
    if (!this.target || ['checking', 'downloading', 'installing'].includes(this.snapshot.phase)) return;
    this.update({ phase: 'checking', error: undefined });
    try {
      const release = await fetchLatestRelease(this.deps.fetch);
      if (!release || !isNewer(release.version)) {
        this.update({ phase: 'current', release: undefined, checkedAt: this.deps.now?.() ?? Date.now(), promptOpen: false });
        return;
      }
      const rosStack = this.snapshot.release?.version === release.version && this.snapshot.rosStack !== undefined
        ? this.snapshot.rosStack
        : await rosStackChangesBetween(APP_VERSION, release.version, this.deps.fetch);
      const quiet = this.read(SKIPPED_KEY) === release.version || this.snoozed.has(release.version);
      this.update({ phase: 'available', release, installer: installerFor(release, this.target), rosStack, downloaded: false, promptOpen: asked || !quiet });
    } catch (error) {
      // An automatic check that fails says nothing; the next one tries again.
      this.update({ phase: asked ? 'failed' : 'idle', error: asked ? messageOf(error) : undefined, promptOpen: asked });
    }
  }

  /** Download the installer, have the shell check and install it, and let the app restart into it. */
  async install() {
    const { release, installer, rosStack } = this.snapshot;
    if (!this.updater || !release || !installer || ['downloading', 'installing'].includes(this.snapshot.phase)) return;
    this.update({ phase: 'downloading', progress: { received: 0, total: installer.size }, error: undefined, promptOpen: true });
    try {
      await this.updater.download({ tag: release.tag, name: installer.name }, (received, total) => this.update({ progress: { received, total } }));
    } catch (error) {
      if (this.snapshot.phase !== 'downloading') return; // Cancelled.
      this.update({ phase: 'failed', error: messageOf(error), downloaded: false });
      return;
    }
    this.update({ phase: 'installing', downloaded: true });
    // Kept across the restart: the reminder is for the version that is about to start.
    if (rosStack?.length) this.write(ROS_REMINDER_KEY, JSON.stringify({ from: APP_VERSION, to: release.version, files: rosStack }));
    try {
      await this.updater.install();
    } catch (error) {
      this.update({ phase: 'failed', error: messageOf(error) });
    }
  }

  async cancel() {
    if (this.snapshot.phase !== 'downloading') return;
    this.update({ phase: 'available', progress: undefined });
    await this.updater?.cancel().catch(() => undefined);
  }

  /** Put it away until the next launch; the menu still offers it. */
  later() {
    if (this.snapshot.release) this.snoozed.add(this.snapshot.release.version);
    this.update({ promptOpen: false, error: undefined, ...(this.snapshot.phase === 'failed' ? { phase: this.snapshot.release ? 'available' : 'idle' } : {}) });
  }

  /** Stop offering this version on its own; a newer one, or a check someone asks for, offers again. */
  skip() {
    if (this.snapshot.release) this.write(SKIPPED_KEY, this.snapshot.release.version);
    this.later();
  }

  /** From the menu: show what is available, or look again. */
  open() {
    if (this.snapshot.release && ['available', 'failed'].includes(this.snapshot.phase)) this.update({ promptOpen: true });
    else if (!['downloading', 'installing'].includes(this.snapshot.phase)) void this.check(true);
  }

  async openInstaller() {
    try {
      await this.updater?.openInstaller();
      this.update({ promptOpen: false });
    } catch (error) {
      this.update({ error: messageOf(error) });
    }
  }

  async openReleasePage() {
    const tag = this.snapshot.release?.tag;
    if (tag) await this.updater?.openReleasePage(tag).catch(error => this.update({ error: messageOf(error) }));
  }

  /** The ROS host has been updated, or the person does not want to hear about it again. */
  dismissRosReminder(forGood: boolean) {
    if (forGood) this.write(ROS_REMINDER_KEY, null);
    this.update({ rosReminder: undefined });
  }

  private pendingRosReminder(): RosStackReminder | undefined {
    try {
      const stored = JSON.parse(this.read(ROS_REMINDER_KEY) ?? 'null') as RosStackReminder | null;
      if (!stored || typeof stored.to !== 'string' || !Array.isArray(stored.files)) return undefined;
      // Shown only once the update it belongs to is running; a stale one is dropped.
      if (stored.to === APP_VERSION) return { from: String(stored.from), to: stored.to, files: stored.files.map(String) };
      if (!isNewer(stored.to)) this.write(ROS_REMINDER_KEY, null);
    } catch {
      this.write(ROS_REMINDER_KEY, null);
    }
    return undefined;
  }
}

// Electron prefixes an error from the main process with the channel it came through.
const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

const storage = typeof window === 'undefined' ? undefined : (() => { try { return window.localStorage; } catch { return undefined; } })();
export const appUpdater = new AppUpdater({ getUpdater: getDesktopUpdater, storage });

export const useAppUpdate = () => useSyncExternalStore(appUpdater.subscribe, appUpdater.getSnapshot);
