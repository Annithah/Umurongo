import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { colors } from './src/theme/tokens.js';
import { en } from '../packages/shared/src/i18n/en';
import { rw } from '../packages/shared/src/i18n/rw';

// In development the web app proxies /api and /socket.io to the API on port 4000,
// so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [
    react(),
    // Installable PWA. The service worker caches the app shell only, never API data
    // (the patient page keeps its own last-known copy of the ticket for offline use).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-64.png', 'apple-touch-icon.png', 'logo-320.png'],
      manifest: {
        name: 'Umurongo',
        short_name: 'Umurongo',
        description: `${rw.tagline} ${en.tagline}`,
        lang: 'rw',
        start_url: '/',
        display: 'standalone',
        background_color: colors.bg,
        theme_color: colors.navy.DEFAULT,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only what a patient's phone (and the TV) needs. Staff and admin screens are
        // cached the first time they are opened, so a patient never downloads them on mobile data.
        globPatterns: ['index.html', 'assets/*.{js,css}', 'favicon-64.png', 'logo-320.png'],
        globIgnores: [
          'assets/{StaffApp,Login,Invite,Reception,QueueBoard,TeamBoard,MyQueue,Analytics,charts,SmsPanel,Departments,Rooms,StaffAccounts,SmsTemplates,Settings,Jobs,Audit,NoShowButton,ReasonDialog,PrintTicket,common}-*.js',
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'umurongo-assets', expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 3600 } },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true, // reachable from a phone on the same Wi-Fi
    // API_PROXY lets the end-to-end tests point the web app at a test API on another port.
    proxy: {
      '/api': process.env.API_PROXY ?? 'http://localhost:4000',
      '/socket.io': { target: process.env.API_PROXY ?? 'http://localhost:4000', ws: true },
    },
  },
});
