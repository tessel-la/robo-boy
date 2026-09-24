import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// import mkcert from 'vite-plugin-mkcert' // Ensure mkcert is commented out/removed

const packagedHtmlCompatibilityPlugin = (): Plugin => ({
  name: 'packaged-html-compatibility',
  apply: 'build',
  transformIndexHtml(html) {
    // Neither packaged shell needs CORS on its own assets -- Tauri serves them over a custom
    // protocol, Electron straight from disk -- and both refuse a crossorigin module fetched that
    // way. Keep the Vite entry an ES module: production chunks contain imports/exports, and
    // converting it to a classic deferred script prevents React booting.
    return html.replace(/\s+crossorigin(?=(\s|>|$))/g, '');
  },
});

const roslibGlobalThisPlugin = (): Plugin => ({
  name: 'roslib-global-this',
  apply: 'build',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]node_modules[\\/]roslib[\\/]src[\\/]RosLib\.js$/.test(id)) {
      return null;
    }

    return code.replace('var ROSLIB = this.ROSLIB ||', 'var ROSLIB = globalThis.ROSLIB ||');
  },
});

const parsePort = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;

  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
};

/** Typed as a map so both branches of the alias choice agree on one shape. */
const tauriStubAliases: Record<string, string> = {
  '@tauri-apps/plugin-http': fileURLToPath(new URL('../src/panels/nativeHttpFetch.web.ts', import.meta.url)),
  '@tauri-apps/api/window': fileURLToPath(new URL('../src/runtime/nativeWindow.web.ts', import.meta.url)),
};

// Set by the Tauri CLI when it serves the frontend to a phone or tablet.
const devHost = process.env.TAURI_DEV_HOST;
const devPort = parsePort(process.env.FRONTEND_PORT ?? process.env.VITE_PORT, 5173);

// Vite rejects requests carrying a Host header it does not recognise, so a browser on the
// network cannot trick it into serving source to another origin. Localhost and bare IPs are
// allowed on their own; a deployment reached through Caddy under a real hostname has to name
// that hostname here. A leading dot covers every subdomain of a fleet domain.
const allowedHosts = (process.env.ROBOBOY_ALLOWED_HOSTS ?? '')
  .split(',')
  .map(host => host.trim())
  .filter(Boolean);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // A packaged shell loads the built page from disk, so every asset has to be named relative to
  // it. Only the web app is served from a site root.
  base: mode === 'tauri' || mode === 'electron' ? './' : '/',
  // External panel releases are deployment inputs, not Robo-Boy source files.
  // Explicit panel builds point this at the generated .panel-stage/public tree.
  publicDir: process.env.ROBOBOY_PUBLIC_DIR || 'public',
  resolve: {
    // Only the Tauri build reaches its native packages. Every other build -- the web app and the
    // Electron shell, which brings its own bridge -- resolves stubs instead, so neither running
    // nor type-checking them requires a desktop-only package to be installed.
    alias: mode === 'tauri' ? {} : tauriStubAliases,
    // MainControlView is lazy-loaded after the connection screen. Keep hooks
    // and the renderer on one React instance across linked panel SDKs and
    // dependency-optimizer generations.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // semver is first reached through the lazy external-panel registry. Make
    // it part of the initial dev optimization pass so login cannot trigger a
    // dependency re-bundle while React is mounting MainControlView.
    // The replay worker's dependencies are only reached when a recording is opened; the
    // resulting re-bundle would reload the page and abort that first load.
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'semver',
      '@mcap/core',
      '@mcap/browser',
      '@foxglove/rosmsg',
      '@foxglove/rosmsg-serialization',
      '@foxglove/rosmsg2-serialization',
      'fzstd',
    ],
  },
  server: {
    // `tauri ios dev` runs the app on a device that reaches this server over the network, and
    // names the address it will use. Everywhere else, listen on all interfaces within the container.
    host: devHost || '0.0.0.0',
    port: devPort,
    // A device is told one port up front, so silently moving to the next free one would leave it
    // loading nothing.
    strictPort: Boolean(devHost),
    // The Tauri dev host is a name the CLI picked for this run, so it is always trusted here.
    allowedHosts: [...(devHost ? [devHost] : []), ...allowedHosts],
    hmr: devHost ? { protocol: 'ws', host: devHost, port: devPort + 1 } : undefined,
    proxy: {
      '/api/panels': {
        target: process.env.PANEL_MANAGER_PROXY_TARGET ?? 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
      '/ollama': {
        target: process.env.OLLAMA_PROXY_TARGET ?? 'http://127.0.0.1:11434',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/ollama/, ''),
      },
      '/webrtc/_discovery/paths': {
        target: process.env.WEBRTC_DISCOVERY_PROXY_TARGET ?? 'http://127.0.0.1:9997',
        changeOrigin: true,
        rewrite: () => '/v3/paths/list',
      },
      '/webrtc': {
        target: process.env.WEBRTC_PROXY_TARGET ?? 'http://127.0.0.1:8889',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/webrtc/, ''),
      },
    },
    // https: false, // Ensure HTTPS is disabled (default is false anyway)
    // hmr: { // Optional: Specify host for Hot Module Replacement if needed
    //   host: 'localhost', // Browser connects to Caddy on localhost
    //   protocol: 'wss' // HMR connection should also go through Caddy (WSS)
    // }
  },
  plugins: [
    react(),
    roslibGlobalThisPlugin(),
    ...(mode === 'tauri' || mode === 'electron' ? [packagedHtmlCompatibilityPlugin()] : []),
    ...(mode === 'tauri' || mode === 'electron'
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate', // Automatically update service worker
            devOptions: {
              enabled: process.env.VITE_PWA_DEV !== 'false', // Enable PWA in development for testing
            },
            // Use our external manifest file instead of inline configuration
            manifest: false, // Disable inline manifest
            injectRegister: 'auto',
            includeAssets: ['favicon.ico'], // Include any additional assets
            workbox: {
              // Registry and manifest JSON must be available before any lazy
              // panel bundle can be discovered while the PWA is offline.
              globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webmanifest}'],
            },
            // The manifest is now defined in the manifest.webmanifest file
          }),
        ]),
    // mkcert() // Ensure mkcert is commented out/removed
  ],
  build: {
    outDir: process.env.ROBOBOY_DIST_DIR || 'dist',
    chunkSizeWarningLimit: 1600,
  },
}));
