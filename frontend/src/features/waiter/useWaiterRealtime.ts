import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import { waiterVoice } from '@/services/waiterVoice';
import type { AppNotification, Order, ReceiptPrintRequest } from '@/types';
import { useReceiptPrint } from './receiptPrint';

type VoicedOrder = Order & { voice?: { text?: string | null; waiterText?: string | null } | null };

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
  const tableNumber = order.table?.number;
  const tableNumberText =
    typeof tableNumber === 'number' || typeof tableNumber === 'string'
      ? tableNumberVoice(tableNumber)
      : '';
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

/** Текст голосового уведомления официанту по статусу заказа (с номером стола). */
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

/** Подписки официанта на real-time события сервера. */
export function useWaiterRealtime() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);
  const userId = useAuth((s) => s.user?.id);
  // Защита от повторной озвучки одного и того же статуса заказа.
  const voicedRef = useRef<Map<string, string>>(new Map());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['halls'] });
    qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
  };

  const speakWaiterOrder = (order: VoicedOrder) => {
    if (!order.waiter?.id || order.waiter.id !== userId) return;
    const text = waiterVoiceText(order);
    const voiceKey = `${order.status}:${text}`;
    if (!text || voicedRef.current.get(order.id) === voiceKey) return;
    voicedRef.current.set(order.id, voiceKey);
    waiterVoice.enqueue(text);
  };

  useSocketEvent<AppNotification>('notification:new', (n) => {
    const orderNumber = n.orderNumber ? displayOrderNumber(n.orderNumber) : undefined;
    const message = n.orderNumber && orderNumber ? n.message.replace(n.orderNumber, orderNumber) : n.message;
    push({ message, type: n.type ?? 'info', orderId: n.orderId, orderNumber, at: n.at });
    beep('notify');
  });

  useSocketEvent<VoicedOrder>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    invalidate();

    // Голосовое уведомление — только по своим заказам и только на новый статус.
    speakWaiterOrder(order);
  });
  useSocketEvent<VoicedOrder>('waiter:order_ready', (order) => {
    invalidate();
    speakWaiterOrder(order);
  });
  useSocketEvent<VoicedOrder>('waiter:order_rejected', (order) => {
    invalidate();
    speakWaiterOrder(order);
  });
  useSocketEvent('waiter:shift_started', () =>
    qc.invalidateQueries({ queryKey: ['waiter', 'shift'] }),
  );
  useSocketEvent('waiter:shift_ended', () =>
    qc.invalidateQueries({ queryKey: ['waiter', 'shift'] }),
  );
  const invalidateTables = () => {
    qc.invalidateQueries({ queryKey: ['halls'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };
  useSocketEvent('table:status_changed', invalidateTables);
  useSocketEvent('tables:updated', invalidateTables);
  // Админ изменил меню/категории/сеты — обновляем меню официанта без перезагрузки.
  useSocketEvent('menu:updated', () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['dishes'] });
  });
  // Владелец изменил QR, способы оплаты или другие публичные настройки.
  useSocketEvent('settings:updated', () => {
    qc.invalidateQueries({ queryKey: ['settings'] });
  });

  // Печать чека/счёта: подтверждение администратора ещё не означает фактическую печать.
  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_approved', (req) => {
    const st = useReceiptPrint.getState();
    if (st.request?.id !== req.id) return;
    if (st.sheetOpen) st.resolve('pending');
  });

  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_printed', (req) => {
    const st = useReceiptPrint.getState();
    if (st.request?.id !== req.id) return;
    if (st.sheetOpen) {
      st.resolve('printed');
    } else {
      const label = req.type === 'preliminary' ? 'Счёт' : 'Чек';
      push({
        message: `${label} ${displayOrderNumber(req.orderNumber)} распечатан. Заберите ${label.toLowerCase()}.`,
        type: 'success',
        at: new Date().toISOString(),
      });
      st.dismiss();
      beep('notify');
    }
  });

  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_rejected', (req) => {
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
    beep('notify');
  });
}
