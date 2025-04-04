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
      manifest: {
        name: 'Robot Web Controller',
        short_name: 'RobotCtrl',
        description: 'Web interface for controlling ROS 2 robots.',
        theme_color: '#282c34', // Match dark theme background
        background_color: '#ffffff', // White background for splash screen
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png', // Standard icon size
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png', // Larger icon size
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png', // Maskable icon (if you create one)
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    }),
    // mkcert() // Ensure mkcert is commented out/removed
  ],
}) 