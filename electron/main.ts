import { app, BrowserWindow, ipcMain, net, protocol, shell, session } from 'electron';
import { hasAgentBackground, registerAgentBackground } from './agentBackground';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerUpdater } from './updater';
import { registerRobotResources, robotResourceScheme } from './robotResources';
import { fetchEmbed, isEmbedHost, registerEmbedProxy } from './embedProxy';
import { configureCertificates } from './certificates';
import { registerPanelFetch } from './panelFetch';
import { registerAssistantSubscriptions } from './assistant';

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
 * The origin the packaged renderer is served from.
 *
 * Loading the built page straight off disk seems simpler, and is wrong: Chromium gives every
 * file:// document an opaque origin. `location.origin` still reports "file://", but the origin
 * that actually arrives on a message event is "null", and anything comparing the two disagrees
 * with itself. The panel sandbox does exactly that -- the host tells it which origin to trust, the
 * sandbox checks incoming messages against that name -- so under file:// it discarded every probe
 * and never reported that it had started.
 *
 * A scheme registered as standard carries a real, non-opaque origin, so the packaged app behaves
 * the way the same code does over http in a browser. Tauri solves this the same way, with
 * tauri://localhost.
 */
const RENDERER_SCHEME = 'app';
const RENDERER_HOST = 'robo-boy';
const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`;

/** Enough of a content type for what a built Vite renderer actually contains. */
const CONTENT_TYPES = new Map(
  Object.entries({
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.webmanifest': 'application/manifest+json',
    '.map': 'application/json',
  })
);

/**
 * Reads one file of the built renderer.
 *
 * Files are read rather than fetched off disk because a packaged app keeps them inside app.asar,
 * which Node's filesystem understands and the network stack does not.
 */
const readRendererFile = async (rendererRoot: string, pathname: string): Promise<Response> => {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.join(rendererRoot, relativePath);

  // A request is only ever for something inside the built renderer. Anything that climbs out of
  // it -- through .. segments, or an absolute path -- is refused rather than resolved.
  if (target !== rendererRoot && !target.startsWith(rendererRoot + path.sep)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const body = await readFile(target);
    return new Response(body, {
      headers: { 'content-type': CONTENT_TYPES.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};

/**
 * Serves {@link RENDERER_SCHEME}: the built renderer on {@link RENDERER_HOST}, and on each
 * connection's embed host its panel sandbox and the robot's `/<port>/` frames (see embedProxy.ts).
 *
 * Under the dev server the renderer comes from Vite, so only the embed hosts are answered here and
 * their sandbox document is fetched from Vite as well.
 */
const serveRenderer = (rendererRoot: string | null): void => {
  protocol.handle(RENDERER_SCHEME, async request => {
    const { hostname, pathname } = new URL(request.url);
    if (isEmbedHost(hostname)) {
      return fetchEmbed(request, () =>
        rendererRoot
          ? readRendererFile(rendererRoot, '/panel-sandbox.html')
          : net.fetch(new URL('panel-sandbox.html', devServerUrl).href)
      );
    }
    if (!rendererRoot) return new Response('Not found', { status: 404 });
    return readRendererFile(rendererRoot, pathname);
  });
};

/**
 * Chromium flags the video panels depend on.
 *
 * The privileged app:// origin provides the secure context WebRTC needs even when the gateway
 * is reached over plain HTTP. Self-signed HTTPS is handled by configureCertificates, not a flag
 * that disables certificate checks throughout Chromium.
 */
const configureChromium = (): void => {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
};

/**
 * How the window frame is drawn.
 *
 * Elsewhere the app draws its own title bar and resize edges, exactly as it does under Tauri. A Mac
 * user expects the system's close, minimise and zoom buttons at the top left, so there the native
 * frame stays and only its title bar is hidden: the system buttons sit inside the app's own bar,
 * centred on its height (--title-bar-height in src/index.css), and the app leaves its own out.
 */
const windowFrame = (): Electron.BrowserWindowConstructorOptions =>
  process.platform === 'darwin'
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } }
    : { frame: false };

const createWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1f242d',
    ...windowFrame(),
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
  window.on('close', event => { if (hasAgentBackground(window)) { event.preventDefault(); window.hide(); } });

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

  await window.loadURL(devServerUrl ?? `${RENDERER_ORIGIN}/index.html`);

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

  // Has to be declared before the app is ready, while the schemes are still being decided.
  protocol.registerSchemesAsPrivileged([
    robotResourceScheme,
    {
      scheme: RENDERER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);

  void app.whenReady().then(async () => {
    configureCertificates();
    serveRenderer(devServerUrl ? null : path.join(currentDir, '../renderer'));
    configurePermissions();
    registerEmbedProxy();
    registerRobotResources(devServerUrl ? new URL(devServerUrl).origin : RENDERER_ORIGIN);
    registerPanelFetch();
    registerAssistantSubscriptions(devServerUrl ? new URL(devServerUrl).origin : RENDERER_ORIGIN);
    registerAgentBackground(devServerUrl ? new URL(devServerUrl).origin : RENDERER_ORIGIN);
    registerWindowControls();
    registerUpdater();

    const window = await createWindow();
    if (isDev) window.webContents.openDevTools({ mode: 'detach' });

    // macOS keeps an application running with no windows; clicking its dock icon opens one again.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
      else BrowserWindow.getAllWindows()[0].show();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
