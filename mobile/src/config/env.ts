/**
 * Конфигурация окружения мобильного клиента.
 * EXPO_PUBLIC_API_URL пробрасывается Expo на этапе сборки (см. .env).
 */
const DEFAULT_API_URL = 'https://edu-production-056d.up.railway.app';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');

/** Базовый префикс REST API. */
export const API_BASE = `${API_URL}/api`;

// Публичный веб-адрес PWA — база QR-меню столов (origin/menu/:token). В PWA это
// window.location.origin. Задайте EXPO_PUBLIC_WEB_URL реальным адресом фронта;
// по умолчанию совпадает с API-хостом (для валидного, но не обязательно рабочего URL).
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? API_URL).replace(/\/$/, '');
