import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json') as { version: string };

function git(cmd: string): string | null {
  try {
    return execSync(cmd).toString().trim() || null;
  } catch {
    return null;
  }
}

const env = process.env;

/** Коммит сборки: сначала из git, потом из env хостинга. Нет — пустая строка (без «dev»). */
function buildCommit(): string {
  const sha =
    git('git rev-parse --short HEAD') ??
    env.RAILWAY_GIT_COMMIT_SHA ??
    env.VERCEL_GIT_COMMIT_SHA ??
    env.COMMIT_REF ?? // Netlify
    env.RENDER_GIT_COMMIT ??
    env.GITHUB_SHA ??
    env.SOURCE_VERSION ?? // Heroku/Cloudflare
    '';
  return sha ? sha.slice(0, 7) : '';
}

/**
 * Маркетинговая версия `major.minor.patch`. major.minor — из package.json
 * (контролируется вручную для крупных релизов). patch — авто-инкремент по числу
 * сборок/коммитов: git-счётчик, иначе номер CI-сборки, иначе VITE_APP_BUILD из env,
 * иначе patch из package.json. Версия меняется на каждой сборке, где доступен любой
 * из этих источников.
 */
function appVersion(): string {
  if (env.VITE_APP_VERSION) return env.VITE_APP_VERSION; // явный полный оверрайд
  const [major = '0', minor = '1', patch = '0'] = pkg.version.split('.');
  const build =
    env.VITE_APP_BUILD ?? // явный приоритет (переменная Railway)
    git('git rev-list --count HEAD') ?? // локально/где есть git — авто-счётчик
    env.GITHUB_RUN_NUMBER ?? // GitHub Actions
    env.BUILD_NUMBER ??
    patch;
  return `${major}.${minor}.${build}`;
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.png', 'sounds/*.mp3', 'sounds/*.wav', 'sounds/*.ogg'],
      workbox: {
        importScripts: ['push-sw.js'],
        // Новый SW активируется сразу — не ждёт закрытия всех вкладок
        skipWaiting: true,
        clientsClaim: true,
        // SW-файл не кэшируется HTTP-кэшем браузера — всегда проверяется с сервера
        // (без этого браузер может игнорировать обновления до 24 часов)
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
