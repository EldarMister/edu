import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/store/auth';
import { API_URL } from '@/config/env';

let socket: Socket | null = null;

/** Singleton-сокет, подключённый с текущим JWT (тот же способ, что и PWA). */
export function getSocket(): Socket {
  const token = useAuth.getState().accessToken;
  if (!socket) {
    socket = io(API_URL, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
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

/** Переустанавливает соединение с актуальным токеном (после refresh/логина). */
export function reconnectSocket() {
  if (!socket) {
    getSocket();
    return;
  }
  socket.auth = { token: useAuth.getState().accessToken };
  socket.disconnect();
  socket.connect();
}

/** Хук: статус соединения. Используется индикатором «Онлайн / Нет соединения». */
export function useConnectionStatus(): boolean {
  const s = getSocket();
  const [connected, setConnected] = useState<boolean>(() => s.connected);

  useEffect(() => {
    const sock = getSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    setConnected(sock.connected);

    // При возврате приложения из фона — поднимаем соединение.
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active' && !sock.connected) {
        sock.connect();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
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
