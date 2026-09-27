import type { UpdateTarget } from '../features/appUpdate/releases';
import { getDesktopBridge } from './desktopBridge';
import { isDesktopRuntime, isMobilePlatform } from './runtimeConfig';

/** Which installer of which release to fetch. */
export interface UpdateDownload {
  tag: string;
  name: string;
}

/**
 * What the desktop shells do for an update. The app decides whether and what to update; the shell
 * does everything that has to be trusted. It looks the installer up on GitHub itself, over its own
 * certificate-checked connection (Electron's page runs with certificate errors ignored, for
 * robots' self-signed certificates), downloads it only from GitHub's hosts, checks it against the
 * SHA-256 GitHub publishes, and keeps the checked file to itself, so installing never takes a path
 * or a checksum from the page.
 */
export interface DesktopUpdater {
  /** How this copy was installed, or null when it cannot update itself (a development build). */
  target(): Promise<UpdateTarget | null>;
  download(asset: UpdateDownload, onProgress: (received: number, total: number) => void): Promise<void>;
  cancel(): Promise<void>;
  /** Installs the checked download and restarts the app into it; rejects with the reason when it cannot. */
  install(): Promise<void>;
  /** Hands the checked download to the system's own installer, for when installing in place fails. */
  openInstaller(): Promise<void>;
  /** Opens a release's page on GitHub in the system browser. */
  openReleasePage(tag: string): Promise<void>;
}

interface ProgressEvent { payload: { received: number; total: number } }

/** The updater of the shell the app runs in; null in a browser and on phones, which update elsewhere. */
export async function getDesktopUpdater(): Promise<DesktopUpdater | null> {
  if (!isDesktopRuntime() || isMobilePlatform()) return null;
  const bridge = getDesktopBridge();
  if (bridge) return bridge.updater ?? null;

  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  return {
    target: () => invoke<UpdateTarget | null>('update_target'),
    download: async (asset, onProgress) => {
      const stop = await listen('roboboy://update-progress', (event: ProgressEvent) => onProgress(event.payload.received, event.payload.total));
      try {
        await invoke('update_download', { ...asset });
      } finally {
        stop();
      }
    },
    cancel: () => invoke('update_cancel'),
    install: () => invoke('update_install'),
    openInstaller: () => invoke('update_open_installer'),
    openReleasePage: tag => invoke('update_open_release_page', { tag }),
  };
}
