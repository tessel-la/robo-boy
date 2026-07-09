import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// import mkcert from 'vite-plugin-mkcert' // Ensure mkcert is commented out/removed

const tauriHtmlCompatibilityPlugin = (): Plugin => ({
  name: 'tauri-html-compatibility',
  apply: 'build',
  transformIndexHtml(html) {
    return html
      .replace(/\s+crossorigin(?=(\s|>|$))/g, '')
      .replace(/<script type="module" src=/g, '<script defer src=');
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

    return code.replace(
      'var ROSLIB = this.ROSLIB ||',
      'var ROSLIB = globalThis.ROSLIB ||',
    );
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'tauri' ? './' : '/',
  server: {
    host: '0.0.0.0', // Listen on all interfaces within the container
    port: 5173,
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
            // The manifest is now defined in the manifest.webmanifest file
          }),
        ]),
    // mkcert() // Ensure mkcert is commented out/removed
  ],
  build: {
    chunkSizeWarningLimit: 1600,
  },
}));
