import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '@/store/auth';
import { API_BASE, API_URL } from '@/config/env';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

// Подставляем access token в каждый запрос.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// При 401 — один раз пробуем обновить токены через refresh.
let refreshing: Promise<string | null> | null = null;

async function refreshTokens(): Promise<string | null> {
  const { refreshToken, setTokens, logout } = useAuth.getState();
  if (!refreshToken) {
    logout();
    return null;
  }
  try {
    const res = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken as string;
  } catch {
    logout();
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      refreshing = refreshing ?? refreshTokens();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Политика повторов мутаций: повторяем только сетевые сбои, но не 4xx/5xx.
 * До 2 попыток — помогает на нестабильной мобильной сети.
 */
export function networkRetry(failureCount: number, err: unknown): boolean {
  if (failureCount >= 2) return false;
  if (axios.isAxiosError(err)) {
    return !err.response && (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED');
  }
  return false;
}

/** Человекочитаемое сообщение об ошибке из ответа API. */
export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg = (err.response?.data as { message?: string | string[] })?.message;
    if (Array.isArray(msg)) return msg[0];
    if (typeof msg === 'string') return msg;
    if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') {
      return 'Нет соединения с сервером';
    }
  }
  return 'Произошла ошибка. Попробуйте ещё раз.';
}
