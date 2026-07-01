import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/store/auth';
import { API_URL } from '@/config/env';

let socket: Socket | null = null;
const OFFLINE_GRACE_MS = 5500;

function socketIsConnecting(sock: Socket) {
  return Boolean((sock as Socket & { active?: boolean }).active);
}

function shouldConnectNow() {
  return AppState.currentState === 'active' && !!useAuth.getState().accessToken;
}

function connectIfNeeded(sock: Socket) {
  if (!shouldConnectNow()) return;
  if (sock.connected || socketIsConnecting(sock)) return;
  sock.connect();
}

/** Singleton-сокет, подключённый с текущим JWT (тот же способ, что и PWA). */
export function getSocket(): Socket {
  const token = useAuth.getState().accessToken;
  if (!socket) {
    socket = io(API_URL, {
      auth: { token },
      // Как в PWA: websocket предпочтительнее, polling оставляем fallback для
      // нестабильной мобильной сети и прокси, где чистый websocket не поднимается.
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      reconnectionAttempts: Infinity,
    });
  } else {
    // Обновляем токен на случай повторного входа.
    socket.auth = { token };
  }
  connectIfNeeded(socket);
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Переустанавливает соединение с актуальным токеном (после refresh/логина). */
export function reconnectSocket() {
  if (!socket) {
    getSocket();
    return;
  }
  socket.auth = { token: useAuth.getState().accessToken };
  if (socket.connected || socketIsConnecting(socket)) {
    socket.disconnect();
  }
  connectIfNeeded(socket);
}

/** Один lifecycle-хук на всё приложение: без дублей из разных индикаторов. */
export function useSocketLifecycle() {
  useEffect(() => {
    const sock = getSocket();
    connectIfNeeded(sock);

    const onAppState = (next: AppStateStatus) => {
      if (next !== 'active') return;
      const id = setTimeout(() => connectIfNeeded(sock), 350);
      return () => clearTimeout(id);
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      sub.remove();
    };
  }, []);
}

/** Хук: статус соединения. Используется индикатором «Онлайн / Нет соединения». */
export function useConnectionStatus(): boolean {
  const s = getSocket();
  const [connected, setConnected] = useState<boolean>(() => s.connected || AppState.currentState !== 'active');

  useEffect(() => {
    const sock = getSocket();
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    const clearOfflineTimer = () => {
      if (!offlineTimer) return;
      clearTimeout(offlineTimer);
      offlineTimer = null;
    };
    const onConnect = () => setConnected(true);
    const markOfflineSoon = () => {
      clearOfflineTimer();
      if (AppState.currentState !== 'active') {
        setConnected(true);
        return;
      }
      offlineTimer = setTimeout(() => {
        if (!sock.connected && AppState.currentState === 'active') setConnected(false);
      }, OFFLINE_GRACE_MS);
    };
    const onDisconnect = () => markOfflineSoon();
    const onConnectError = () => markOfflineSoon();

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('connect_error', onConnectError);
    setConnected(sock.connected || AppState.currentState !== 'active');

    const onAppState = (next: AppStateStatus) => {
      if (next !== 'active') {
        clearOfflineTimer();
        setConnected(true);
        return;
      }
      setConnected(sock.connected || true);
      setTimeout(() => {
        if (!sock.connected) markOfflineSoon();
      }, 600);
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      clearOfflineTimer();
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('connect_error', onConnectError);
      sub.remove();
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
