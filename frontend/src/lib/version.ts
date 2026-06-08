// Данные сборки вшиваются на этапе vite build (см. define в vite.config.ts).
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
export const APP_BUILT_AT = __APP_BUILT_AT__;

/** Дата и время сборки в формате ДД.ММ.ГГГГ ЧЧ:ММ (меняется на каждом деплое). */
function builtAtShort(): string {
  const d = new Date(APP_BUILT_AT);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Строка для отображения: «v0.1.38 · a1b2c3d · 08.06.2026 15:30» (пустые части опускаются). */
export const APP_VERSION_LABEL = [`v${APP_VERSION}`, APP_COMMIT, builtAtShort()]
  .filter(Boolean)
  .join(' · ');
