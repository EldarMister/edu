import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json') as { version: string };

function git(cmd: string): string | null {
  try {
    return execSync(cmd).toString().trim();
  } catch {
    return null;
  }
}

// Короткий git-хеш текущей сборки (если git недоступен — 'dev').
function gitCommit(): string {
  return git('git rev-parse --short HEAD') ?? 'dev';
}

/**
 * Маркетинговая версия: major.minor берём из package.json (контролируется
 * вручную для крупных релизов), а patch — число git-коммитов, поэтому версия
 * растёт автоматически с каждой сборкой/деплоем. Без git — fallback на package.json.
 */
function appVersion(): string {
  const [major = '0', minor = '0', patch = '0'] = pkg.version.split('.');
  const count = git('git rev-list --count HEAD');
  return count ? `${major}.${minor}.${count}` : `${major}.${minor}.${patch}`;
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
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
