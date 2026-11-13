import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '@/store/auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// Подставляем access token.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Для FormData убираем JSON Content-Type — браузер сам выставит multipart с boundary.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  return config;
});

// При 401 — пробуем один раз обновить токены через refresh.
const refreshRequests = new Map<string, Promise<string | null>>();

async function refreshTokens(refreshToken: string): Promise<string | null> {
  try {
    const res = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    const session = useAuth.getState();
    if (session.refreshToken !== refreshToken) return null;
    session.setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken as string;
  } catch {
    const session = useAuth.getState();
    if (session.refreshToken === refreshToken) session.logout();
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && original && !original._retry) {
      const { accessToken, refreshToken } = useAuth.getState();
      if (!accessToken || original.headers.Authorization !== `Bearer ${accessToken}`) return Promise.reject(error);
      if (!refreshToken) {
        useAuth.getState().logout();
        return Promise.reject(error);
      }
      original._retry = true;
      let pending = refreshRequests.get(refreshToken);
      if (!pending) {
        pending = refreshTokens(refreshToken).finally(() => refreshRequests.delete(refreshToken));
        refreshRequests.set(refreshToken, pending);
      }
      const newToken = await pending;
      if (newToken && useAuth.getState().accessToken === newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Политика повторов для мутаций: повторяем только сетевые сбои (потерянное
 * соединение/таймаут), но не серверные ответы 4xx/5xx — их повтор бессмыслен.
 * До 2 попыток: помогает на нестабильной мобильной сети.
 */
export function networkRetry(failureCount: number, err: unknown): boolean {
  if (failureCount >= 2) return false;
  if (axios.isAxiosError(err)) {
    return !err.response && (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED');
  }
  return false;
}

/** Достаёт человекочитаемое сообщение об ошибке из ответа API. */
export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg = (err.response?.data as { message?: string | string[] })?.message;
    if (Array.isArray(msg)) return msg[0];
    if (typeof msg === 'string') return msg;
    if (err.code === 'ERR_NETWORK') return 'Нет соединения с сервером';
  }
  return 'Произошла ошибка. Попробуйте ещё раз.';
}

export { API_URL };
