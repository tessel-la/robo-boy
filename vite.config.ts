import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
// import mkcert from 'vite-plugin-mkcert' // Ensure mkcert is commented out/removed

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0', // Listen on all interfaces within the container
    port: 5173
    // https: false, // Ensure HTTPS is disabled (default is false anyway)
    // hmr: { // Optional: Specify host for Hot Module Replacement if needed
    //   host: 'localhost', // Browser connects to Caddy on localhost
    //   protocol: 'wss' // HMR connection should also go through Caddy (WSS)
    // }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // Automatically update service worker
      devOptions: {
        enabled: true // Enable PWA in development for testing
      },
      // Use our external manifest file instead of inline configuration
      manifest: false, // Disable inline manifest
      injectRegister: 'auto',
      includeAssets: ['favicon.ico'], // Include any additional assets
      // The manifest is now defined in the manifest.webmanifest file
    }),
    // mkcert() // Ensure mkcert is commented out/removed
  ],
  build: {
    chunkSizeWarningLimit: 1600,
  },
}) 