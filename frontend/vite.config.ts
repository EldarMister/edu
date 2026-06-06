import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.png', 'sounds/*.mp3', 'sounds/*.wav', 'sounds/*.ogg'],
      workbox: {
        importScripts: ['push-sw.js'],
      },
      manifest: {
        name: 'EDU POS',
        short_name: 'EDU POS',
        description: 'POS-система для кафе/ресторана',
        theme_color: '#005BFF',
        background_color: '#F8FAFC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon.png', sizes: '1254x1254', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
  },
});
