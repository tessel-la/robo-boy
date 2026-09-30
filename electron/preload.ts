import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only channel between the renderer and the desktop shell.
 *
 * The renderer runs with context isolation and no Node integration, so a panel -- which is third
 * party code the operator installed -- cannot reach the file system or spawn anything even if it
 * escapes the app's own guards. What it can reach is named here, and nothing else crosses.
 */

/** A fetched panel asset, in the only shape the context bridge can carry. */
interface PanelFetchReply {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

/** Matches `UpdateTarget` in src/features/appUpdate/releases.ts. */
interface UpdateTarget {
  shell: 'electron';
  os: 'linux';
  arch: 'x64' | 'arm64';
  package: 'deb';
}

/** Matches `ResizeDirection` in src/runtime/desktopWindow.ts, which names the edges as Tauri does. */
type ResizeDirection =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';

/**
 * Whether the system draws the window buttons. On a Mac the shell keeps the native close, minimise
 * and zoom buttons (see `windowFrame` in main.ts), so the title bar leaves room for them instead of
 * drawing its own.
 */
const nativeWindowControls = process.platform === 'darwin';

const desktopBridge = {
  shell: 'electron' as const,
  robotResourceProtocol: true,
  nativeWindowControls,

  window: {
    minimize: () => ipcRenderer.invoke('roboboy:window-minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('roboboy:window-toggle-maximize') as Promise<void>,
    close: () => ipcRenderer.invoke('roboboy:window-close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('roboboy:window-is-maximized') as Promise<boolean>,

    /**
     * Reports window size changes, returning the function that stops reporting them.
     *
     * Maximising is not always the app's own doing -- a keyboard shortcut or a tiling gesture has
     * to reach the title bar's button too -- so the shell forwards every resize.
     */
    onResized: (handler: () => void): Promise<() => void> => {
      const listener = () => handler();
      ipcRenderer.on('roboboy:window-resized', listener);
      return Promise.resolve(() => ipcRenderer.removeListener('roboboy:window-resized', listener));
    },

    /**
     * Chromium resizes a frameless window from CSS, not from the renderer, so the edges the app
     * draws are declared with `-webkit-app-region` and this call has nothing left to do. It exists
     * so the title bar can drive either shell through one interface.
     */
    startResizeDragging: (_direction: ResizeDirection): Promise<void> => Promise.resolve(),
  },

  /**
   * Fetches a panel release in the main process, where the renderer's CORS rules do not apply.
   *
   * Only the hosts the main process lists are reachable. This changes how the bytes arrive and
   * nothing else: the caller still checks them against the origins the source allows and against
   * the SHA-256 published in the inventory entry and the manifest.
   *
   * The reply is a plain record rather than a Response. Only structured-cloneable values cross the
   * context bridge, and a Response sent through it arrives as an object with none of its own
   * accessors -- reading `status` off one gives undefined rather than failing outright, so the
   * caller rebuilds the Response in its own world instead.
   */
  fetchPanelAsset: (url: string, init?: { method?: string }): Promise<PanelFetchReply> =>
    ipcRenderer.invoke('roboboy:panel-fetch', url, init) as Promise<PanelFetchReply>,

  /**
   * Names the robot proxy behind a connection's embed host, so the shell can forward that host's
   * `/<port>/` frames to it. Only a proxy the app itself registers is ever reached.
   */
  registerEmbedTarget: (baseUrl: string): void => ipcRenderer.send('roboboy:embed-register', baseUrl),

  /**
   * Updates. The page names a release and an installer; the main process looks them up, downloads
   * and checks them itself, and installs only the file it checked.
   */
  updater: {
    target: () => ipcRenderer.invoke('roboboy:update-target') as Promise<UpdateTarget | null>,
    download: async (asset: { tag: string; name: string }, onProgress: (received: number, total: number) => void): Promise<void> => {
      const listener = (_event: unknown, received: number, total: number) => onProgress(received, total);
      ipcRenderer.on('roboboy:update-progress', listener);
      try {
        await ipcRenderer.invoke('roboboy:update-download', asset.tag, asset.name);
      } finally {
        ipcRenderer.removeListener('roboboy:update-progress', listener);
      }
    },
    cancel: () => ipcRenderer.invoke('roboboy:update-cancel') as Promise<void>,
    install: () => ipcRenderer.invoke('roboboy:update-install') as Promise<void>,
    openInstaller: () => ipcRenderer.invoke('roboboy:update-open-installer') as Promise<void>,
    openReleasePage: (tag: string) => ipcRenderer.invoke('roboboy:update-open-release', tag) as Promise<void>,
  },
};

export type RoboBoyDesktopBridge = typeof desktopBridge;

contextBridge.exposeInMainWorld('roboBoyDesktop', desktopBridge);
