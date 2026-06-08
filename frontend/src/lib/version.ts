// Данные сборки вшиваются на этапе vite build (см. define в vite.config.ts).
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
export const APP_BUILT_AT = __APP_BUILT_AT__;

/** Дата сборки в формате ДД.ММ.ГГГГ. */
function builtAtShort(): string {
  const d = new Date(APP_BUILT_AT);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Строка для отображения: «v0.1.0 · a1b2c3d · 08.06.2026». */
export const APP_VERSION_LABEL = [`v${APP_VERSION}`, APP_COMMIT, builtAtShort()]
  .filter(Boolean)
  .join(' · ');
