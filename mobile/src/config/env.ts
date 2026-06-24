/**
 * Конфигурация окружения мобильного клиента.
 * EXPO_PUBLIC_API_URL пробрасывается Expo на этапе сборки (см. .env).
 */
const DEFAULT_API_URL = 'https://edu-production-056d.up.railway.app';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');

/** Базовый префикс REST API. */
export const API_BASE = `${API_URL}/api`;
