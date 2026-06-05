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
  return config;
});

// При 401 — пробуем один раз обновить токены через refresh.
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
