import { app, BrowserWindow, ipcMain, net, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Electron desktop shell.
 *
 * Robo-Boy ships two desktop shells. Tauri draws the app in whatever web view the operating
 * system provides, which on Linux is WebKitGTK: it renders the same React tree, but it does not
 * speak the WebRTC the video panels are built on, so those deployments fall back to HLS and watch
 * the robot several seconds late. This shell bundles Chromium instead, so a packaged desktop app
 * gets the same WebRTC stack a browser does and the fallback stays unused.
 *
 * Tauri remains the shell for iOS and Android, where bundling a browser is not an option.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Set by the dev script to the Vite server the renderer is served from. */
const devServerUrl = process.env.ROBOBOY_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);

/**
 * Hosts the renderer may install panels from, matching the scope Tauri's HTTP capability grants.
 *
 * The official inventory publishes manifests and bundles as GitHub release assets, which carry no
 * CORS headers, so the renderer cannot fetch them itself. Requests made here run in the main
 * process, outside that enforcement, which is why the set of reachable hosts is stated rather
 * than left open: everything else is refused before a request is made.
 */
const PANEL_FETCH_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

const isPanelFetchAllowed = (target: string): boolean => {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' && PANEL_FETCH_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

/**
 * Chromium flags the video panels depend on.
 *
 * A robot's WebRTC gateway serves its own certificate on a private address, so the stream is
 * reached over plain HTTP; without this the renderer treats the gateway as an insecure origin and
 * refuses to open the peer connection at all.
 */
const configureChromium = (): void => {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
  // Robots answer on private addresses with self-signed certificates. The renderer only ever
  // reaches the gateway the operator typed in, so a certificate it cannot chain is expected.
  app.commandLine.appendSwitch('ignore-certificate-errors');
};

const createWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1f242d',
    // The app draws its own title bar and resize edges, exactly as it does under Tauri.
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The renderer reaches rosbridge and the video server over plain HTTP on the robot's own
      // address while the app itself is served over a custom protocol.
      webSecurity: true,
    },
  });

  // Showing only once the first frame is ready keeps the window from flashing its background
  // colour before React has mounted.
  window.once('ready-to-show', () => window.show());

  // The title bar's maximise button reflects window state, and that state changes from outside the
  // app too -- a keyboard shortcut, a tiling gesture, a double-click on the bar itself.
  const reportResize = () => {
    if (!window.isDestroyed()) window.webContents.send('roboboy:window-resized');
  };
  window.on('resize', reportResize);
  window.on('maximize', reportResize);
  window.on('unmaximize', reportResize);

  // A link to documentation or a release page belongs in the operator's browser, not in a robot
  // control window that has no address bar to leave.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    await window.loadURL(devServerUrl);
  } else {
    await window.loadFile(path.join(currentDir, '../renderer/index.html'));
  }

  return window;
};

/**
 * Answers the renderer's permission prompts.
 *
 * The camera and microphone belong to the operator's machine and the app never asks for them;
 * what it does ask for is the media *playback* a WebRTC stream needs. Granting only what the app
 * uses keeps a compromised panel from reaching hardware it was never given.
 */
const configurePermissions = (): void => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'fullscreen');
  });
};

const registerPanelFetch = (): void => {
  ipcMain.handle('roboboy:panel-fetch', async (_event, target: string, init?: { method?: string }) => {
    if (!isPanelFetchAllowed(target)) {
      throw new Error(`Refusing to fetch a panel from an unlisted host: ${target}`);
    }

    const response = await net.fetch(target, { method: init?.method ?? 'GET', redirect: 'follow' });
    // The renderer rebuilds a Response from these, so the body crosses as a buffer rather than as
    // a stream, which the bridge cannot carry.
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.arrayBuffer(),
    };
  });
};

const registerWindowControls = (): void => {
  const windowFor = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle('roboboy:window-minimize', event => windowFor(event)?.minimize());
  ipcMain.handle('roboboy:window-close', event => windowFor(event)?.close());
  ipcMain.handle('roboboy:window-is-maximized', event => windowFor(event)?.isMaximized() ?? false);
  ipcMain.handle('roboboy:window-toggle-maximize', event => {
    const window = windowFor(event);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
};

// A second copy would open its own window against the same robot, so the running one is raised
// instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  configureChromium();

  void app.whenReady().then(async () => {
    configurePermissions();
    registerPanelFetch();
    registerWindowControls();

    const window = await createWindow();
    if (isDev) window.webContents.openDevTools({ mode: 'detach' });

    // macOS keeps an application running with no windows; clicking its dock icon opens one again.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
