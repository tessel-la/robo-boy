import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// import mkcert from 'vite-plugin-mkcert' // Ensure mkcert is commented out/removed

const tauriHtmlCompatibilityPlugin = (): Plugin => ({
  name: 'tauri-html-compatibility',
  apply: 'build',
  transformIndexHtml(html) {
    // Tauri custom protocols do not need CORS on same-app assets. Keep the
    // Vite entry as an ES module: production chunks contain imports/exports,
    // and converting it to a classic deferred script prevents React booting.
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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'tauri' ? './' : '/',
  // External panel releases are deployment inputs, not Robo-Boy source files.
  // Explicit panel builds point this at the generated .panel-stage/public tree.
  publicDir: process.env.ROBOBOY_PUBLIC_DIR || 'public',
  resolve: {
    // Only the packaged shell installs panels over Tauri's native HTTP client. Web builds
    // resolve a stub instead, so running the web app never requires the desktop-only package.
    alias:
      mode === 'tauri'
        ? {}
        : {
            '@tauri-apps/plugin-http': fileURLToPath(new URL('../src/panels/nativeHttpFetch.web.ts', import.meta.url)),
            '@tauri-apps/api/window': fileURLToPath(new URL('../src/runtime/nativeWindow.web.ts', import.meta.url)),
          },
    // MainControlView is lazy-loaded after the connection screen. Keep hooks
    // and the renderer on one React instance across linked panel SDKs and
    // dependency-optimizer generations.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // semver is first reached through the lazy external-panel registry. Make
    // it part of the initial dev optimization pass so login cannot trigger a
    // dependency re-bundle while React is mounting MainControlView.
    include: ['react', 'react-dom', 'react-dom/client', 'semver'],
  },
  server: {
    host: '0.0.0.0', // Listen on all interfaces within the container
    port: parsePort(process.env.FRONTEND_PORT ?? process.env.VITE_PORT, 5173),
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
    ...(mode === 'tauri' ? [tauriHtmlCompatibilityPlugin()] : []),
    ...(mode === 'tauri'
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
