import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { API_URL } from './api';

let socket: Socket | null = null;

/** Возвращает singleton-сокет, подключённый с текущим JWT. */
export function getSocket(): Socket {
  const token = useAuth.getState().accessToken;
  if (!socket) {
    socket = io(API_URL, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
    });
  } else {
    // Обновляем токен на случай повторного входа.
    socket.auth = { token };
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
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    setConnected(sock.connected);
    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
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
