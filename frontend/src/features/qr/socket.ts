import { io, type Socket } from 'socket.io-client';
import { useEffect } from 'react';
import { API_URL } from '@/lib/api';
import { getGuestKey } from './guest';

// Отдельный гостевой сокет QR-меню — подключается БЕЗ JWT (backend пускает как гостя).
// Не трогает служебный сокет персонала.
let guestSocket: Socket | null = null;

function getGuestSocket(): Socket {
  if (!guestSocket) {
    guestSocket = io(API_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return guestSocket;
}

export interface QrRealtimeHandlers {
  onCartUpdated?: (payload: unknown) => void;
  onGuestChanged?: () => void;
  onOrderSubmitted?: (payload: { orderId: string; orderNumber: string; status: string }) => void;
  onOrderStatusChanged?: (payload: { orderId: string; status: string }) => void;
}

/** Подключает гостя к комнате стола и подписывает на realtime-события QR-меню. */
export function useQrRealtime(tableId: string | undefined, handlers: QrRealtimeHandlers) {
  useEffect(() => {
    if (!tableId) return;
    const sock = getGuestSocket();

    const join = () => sock.emit('qr:join', { tableId, guestKey: getGuestKey() });
    if (sock.connected) join();
    sock.on('connect', join);
    const heartbeat = window.setInterval(join, 30_000);

    const onCart = (p: unknown) => handlers.onCartUpdated?.(p);
    const onJoined = () => handlers.onGuestChanged?.();
    const onLeft = () => handlers.onGuestChanged?.();
    const onSubmitted = (p: { orderId: string; orderNumber: string; status: string }) =>
      handlers.onOrderSubmitted?.(p);
    const onStatus = (p: { orderId: string; status: string }) => handlers.onOrderStatusChanged?.(p);

    sock.on('qr:cart_updated', onCart);
    sock.on('qr:guest_joined', onJoined);
    sock.on('qr:guest_left', onLeft);
    sock.on('qr:order_submitted', onSubmitted);
    sock.on('qr:order_status_changed', onStatus);

    return () => {
      sock.emit('qr:leave', { tableId });
      window.clearInterval(heartbeat);
      sock.off('connect', join);
      sock.off('qr:cart_updated', onCart);
      sock.off('qr:guest_joined', onJoined);
      sock.off('qr:guest_left', onLeft);
      sock.off('qr:order_submitted', onSubmitted);
      sock.off('qr:order_status_changed', onStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);
}
