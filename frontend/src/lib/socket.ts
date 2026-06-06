import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { API_URL } from './api';

let socket: Socket | null = null;
const VISIBLE_DISCONNECT_GRACE_MS = 8_000;
const HIDDEN_DISCONNECT_GRACE_MS = 60_000;

/** Возвращает singleton-сокет, подключённый с текущим JWT. */
export function getSocket(): Socket {
  const token = useAuth.getState().accessToken;
  if (!socket) {
    socket = io(API_URL, {
      auth: { token },
      // websocket предпочтительнее, но оставляем polling как fallback:
      // на нестабильной мобильной сети чистый websocket часто не поднимается.
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
    });
  } else {
    // Обновляем токен на случай повторного входа.
    socket.auth = { token };
    if (token && !socket.connected) {
      socket.connect();
    }
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Хук: статус соединения. Используется индикатором «Онлайн / Нет соединения». */
export function useConnectionStatus(): boolean {
  const s = getSocket();
  const [connected, setConnected] = useState(s.connected);

  useEffect(() => {
    const sock = getSocket();
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;

    const clearOfflineTimer = () => {
      if (!offlineTimer) return;
      clearTimeout(offlineTimer);
      offlineTimer = null;
    };
    const markOfflineLater = () => {
      clearOfflineTimer();
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      offlineTimer = setTimeout(() => {
        if (!sock.connected) setConnected(false);
      }, hidden ? HIDDEN_DISCONNECT_GRACE_MS : VISIBLE_DISCONNECT_GRACE_MS);
    };
    const onConnect = () => {
      clearOfflineTimer();
      setConnected(true);
    };
    const onDisconnect = () => markOfflineLater();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!sock.connected) sock.connect();
        if (sock.connected) onConnect();
        else markOfflineLater();
      }
    };
    const onBrowserOnline = () => {
      sock.connect();
      markOfflineLater();
    };
    const onBrowserOffline = () => {
      clearOfflineTimer();
      setConnected(false);
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
    if (navigator.onLine === false) setConnected(false);
    else if (sock.connected) setConnected(true);
    else markOfflineLater();
    return () => {
      clearOfflineTimer();
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
    };
  }, []);

  return connected;
}

/** Хук-подписка на событие сокета. handler пересоздаётся через deps. */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const sock = getSocket();
    sock.on(event, handler as (p: unknown) => void);
    return () => {
      sock.off(event, handler as (p: unknown) => void);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
