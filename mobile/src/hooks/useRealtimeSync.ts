import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { beep } from '@/lib/sound';
import { useNotifications } from '@/store/notifications';
import { useAuth } from '@/store/auth';
import { waiterVoice } from '@/services/waiterVoice';
import { useReceiptPrint } from '@/store/receiptPrint';
import { displayOrderNumber } from '@/utils/format';
import { applyOrderStatusToCache } from '@/utils/orderCache';
import type { NotificationType } from '@/store/notifications';
import type { Order, ReceiptPrintRequest } from '@/types';

type VoicedOrder = Order & { voice?: { text?: string | null; waiterText?: string | null } | null };
type RealtimeNotification = {
  message: string;
  type?: NotificationType;
  orderId?: string;
  orderNumber?: string;
  at: string;
};

const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1000) return String(n);
  if (n === 0) return UNITS[0];
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) parts.push(TENS[t]);
    if (u) parts.push(UNITS[u]);
  }
  return parts.join(' ');
}

function tableNumberVoice(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? numberToWords(Number(raw)) : raw;
}

function waiterLocationText(order: Order): string {
  const hall = order.table?.hall?.name?.trim();
  const tableNumberText = tableNumberVoice(order.table?.number);
  const table = tableNumberText ? `Стол номер ${tableNumberText}.` : 'Стол не указан.';
  return [hall ? `Зал ${hall}` : null, table].filter(Boolean).join('. ');
}

function itemName(item: Order['items'][number]): string {
  return item.dishVariantNameSnapshot
    ? `${item.dishNameSnapshot} ${item.dishVariantNameSnapshot}`
    : item.dishNameSnapshot;
}

function rejectedDishNames(order: Order): string[] {
  const names: string[] = [];
  for (const item of order.items ?? []) {
    if (item.status === 'rejected') names.push(itemName(item));
    for (const component of item.setComponents ?? []) {
      if (component.status !== 'rejected') continue;
      names.push(
        component.action === 'replaced' && component.finalNameSnapshot
          ? component.finalNameSnapshot
          : component.originalNameSnapshot,
      );
    }
  }
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function waiterVoiceText(order: VoicedOrder): string | null {
  const location = waiterLocationText(order);
  const rejectedNames = rejectedDishNames(order);
  const rejectedText = rejectedNames.length ? `: ${rejectedNames.join(', ')}` : '';
  switch (order.status) {
    case 'accepted_by_kitchen':
    case 'cooking':
      return order.voice?.waiterText ?? `Кухня приняла ваш заказ. ${location}`;
    case 'ready':
      return `Ваш заказ готов. ${location} Заберите.`;
    case 'rejected':
      return `Кухня отказала${rejectedText}. ${location}`;
    case 'partially_rejected':
      return `Кухня отказала блюдо${rejectedText}. ${location}`;
    default:
      return null;
  }
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
    const speakWaiterOrder = (order: VoicedOrder) => {
      if (!order.waiter?.id || order.waiter.id !== userId) return;
      const text = waiterVoiceText(order);
      const voiceKey = `${order.status}:${text}`;
      if (!text || voicedRef.current.get(order.id) === voiceKey) return;
      voicedRef.current.set(order.id, voiceKey);
      waiterVoice.enqueue(text);
    };
    const onOrderStatusChanged = (order: VoicedOrder) => {
      if (order.source === 'qr' && order.waiter?.id && order.waiter.id !== userId) {
        qc.setQueryData<Order[]>(['orders', 'active'], (current) => current?.filter((item) => item.id !== order.id));
        invalidateOrders();
        return;
      }
      applyOrderStatusToCache(qc, order);
      invalidateOrders();
      speakWaiterOrder(order);
    };
    const onWaiterOrderChanged = (order: VoicedOrder) => {
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
