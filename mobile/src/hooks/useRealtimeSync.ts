import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { beep } from '@/lib/sound';
import { useNotifications } from '@/store/notifications';
import { useAuth } from '@/store/auth';
import { waiterVoice } from '@/services/waiterVoice';
import { waiterVoiceText, type WaiterVoicedOrder } from '@/services/realtimeVoice';
import { isPttBackgroundRuntimeActive } from '@/features/ptt/backgroundFlag';
import { useReceiptPrint } from '@/store/receiptPrint';
import { displayOrderNumber } from '@/utils/format';
import { applyOrderStatusToCache } from '@/utils/orderCache';
import type { NotificationType } from '@/store/notifications';
import type { Order, ReceiptPrintRequest } from '@/types';

type RealtimeNotification = {
  message: string;
  type?: NotificationType;
  orderId?: string;
  orderNumber?: string;
  at: string;
};

function backgroundRuntimeHandlesAudio() {
  return Platform.OS === 'android' && AppState.currentState !== 'active' && isPttBackgroundRuntimeActive();
}

/**
 * Глобальная синхронизация React Query кэша по realtime-событиям (ТЗ §21).
 * Монтируется один раз внутри авторизованной области.
 * При reconnect — рефетч активных данных (invalidateQueries резолвит активные наблюдатели).
 */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);
  const userId = useAuth((s) => s.user?.id);
  const voicedRef = useRef<Map<string, string>>(new Map());
  const printedReceiptSoundRef = useRef<string | null>(null);
  const lastSyncAtRef = useRef(0);

  useEffect(() => {
    const sock = getSocket();

    const invalidateOrders = () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['kitchen'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    };
    const invalidateTables = () => {
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    };
    const invalidateMenu = () => {
      qc.invalidateQueries({ queryKey: ['dishes'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    };
    const invalidateSettings = () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
    };
    const syncVisibleData = () => {
      const now = Date.now();
      if (now - lastSyncAtRef.current < 1_500) return;
      lastSyncAtRef.current = now;
      void qc.refetchQueries({ queryKey: ['orders'], type: 'active' });
      void qc.refetchQueries({ queryKey: ['halls'], type: 'active' });
      void qc.refetchQueries({ queryKey: ['waiter', 'shift'], type: 'active' });
      void qc.refetchQueries({ queryKey: ['categories'], type: 'active' });
      void qc.refetchQueries({ queryKey: ['dishes'], type: 'active' });
    };
    const onNotificationNew = (n: RealtimeNotification) => {
      const orderNumber = n.orderNumber ? displayOrderNumber(n.orderNumber) : undefined;
      const message = n.orderNumber && orderNumber ? n.message.replace(n.orderNumber, orderNumber) : n.message;
      push({ message, type: n.type ?? 'info', orderId: n.orderId, orderNumber, at: n.at });
      if (backgroundRuntimeHandlesAudio()) return;
      void beep('notify');
    };
    const onReceiptApproved = (req: ReceiptPrintRequest) => {
      invalidateOrders();
      const st = useReceiptPrint.getState();
      if (st.request?.id !== req.id) return;
      if (st.sheetOpen) st.resolve('pending');
    };
    const onReceiptPrinted = (req: ReceiptPrintRequest) => {
      invalidateOrders();
      const st = useReceiptPrint.getState();
      if (st.request?.id !== req.id) return;
      if (st.sheetOpen) {
        st.resolve('printed');
        if (printedReceiptSoundRef.current !== req.id) {
          printedReceiptSoundRef.current = req.id;
          void beep('accept');
        }
        return;
      }
      const label = req.type === 'preliminary' ? 'Счёт' : 'Чек';
      push({
        message: `${label} ${displayOrderNumber(req.orderNumber)} распечатан. Заберите ${label.toLowerCase()}.`,
        type: 'success',
        at: new Date().toISOString(),
      });
      st.dismiss();
      void beep('notify');
    };
    const onReceiptRejected = (req: ReceiptPrintRequest) => {
      invalidateOrders();
      const st = useReceiptPrint.getState();
      if (st.request?.id !== req.id) return;
      if (st.sheetOpen) {
        st.resolve('rejected');
      } else {
        push({
          message: 'Печать чека отклонена администратором',
          type: 'error',
          at: new Date().toISOString(),
        });
        st.dismiss();
      }
      void beep('notify');
    };
    const speakWaiterOrder = (order: WaiterVoicedOrder) => {
      if (!order.waiter?.id || order.waiter.id !== userId) return;
      if (backgroundRuntimeHandlesAudio()) return;
      const text = waiterVoiceText(order);
      const voiceKey = `${order.status}:${text}`;
      if (!text || voicedRef.current.get(order.id) === voiceKey) return;
      voicedRef.current.set(order.id, voiceKey);
      waiterVoice.enqueue(text);
    };
    const onOrderStatusChanged = (order: WaiterVoicedOrder) => {
      if (order.source === 'qr' && order.waiter?.id && order.waiter.id !== userId) {
        qc.setQueryData<Order[]>(['orders', 'active'], (current) => current?.filter((item) => item.id !== order.id));
        invalidateOrders();
        return;
      }
      applyOrderStatusToCache(qc, order);
      invalidateOrders();
      speakWaiterOrder(order);
    };
    const onWaiterOrderChanged = (order: WaiterVoicedOrder) => {
      invalidateOrders();
      speakWaiterOrder(order);
    };

    const handlers: Array<[string, () => void]> = [
      [SERVER_EVENTS.ORDER_NEW, invalidateOrders],
      [SERVER_EVENTS.KITCHEN_NEW_ORDER, invalidateOrders],
      [SERVER_EVENTS.WAITER_SHIFT_STARTED, invalidateOrders],
      [SERVER_EVENTS.WAITER_SHIFT_ENDED, invalidateOrders],
      [SERVER_EVENTS.TABLE_STATUS_CHANGED, invalidateTables],
      [SERVER_EVENTS.TABLES_UPDATED, invalidateTables],
      [SERVER_EVENTS.MENU_UPDATED, invalidateMenu],
      [SERVER_EVENTS.SETTINGS_UPDATED, invalidateSettings],
    ];

    handlers.forEach(([event, fn]) => sock.on(event, fn));
    sock.on(SERVER_EVENTS.NOTIFICATION_NEW, onNotificationNew);
    sock.on(SERVER_EVENTS.ORDER_STATUS_CHANGED, onOrderStatusChanged);
    sock.on(SERVER_EVENTS.WAITER_ORDER_READY, onWaiterOrderChanged);
    sock.on(SERVER_EVENTS.WAITER_ORDER_REJECTED, onWaiterOrderChanged);
    sock.on(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, onReceiptApproved);
    sock.on(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, onReceiptPrinted);
    sock.on(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_REJECTED, onReceiptRejected);

    // При восстановлении соединения или возврате в приложение — обновляем активные данные.
    const onReconnect = () => syncVisibleData();
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') syncVisibleData();
    };
    sock.on('connect', onReconnect);
    const appStateSub = AppState.addEventListener('change', onAppState);

    return () => {
      handlers.forEach(([event, fn]) => sock.off(event, fn));
      sock.off(SERVER_EVENTS.NOTIFICATION_NEW, onNotificationNew);
      sock.off(SERVER_EVENTS.ORDER_STATUS_CHANGED, onOrderStatusChanged);
      sock.off(SERVER_EVENTS.WAITER_ORDER_READY, onWaiterOrderChanged);
      sock.off(SERVER_EVENTS.WAITER_ORDER_REJECTED, onWaiterOrderChanged);
      sock.off(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, onReceiptApproved);
      sock.off(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, onReceiptPrinted);
      sock.off(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_REJECTED, onReceiptRejected);
      sock.off('connect', onReconnect);
      appStateSub.remove();
    };
  }, [push, qc, userId]);
}
