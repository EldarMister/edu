import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { beep } from '@/lib/sound';
import { useNotifications } from '@/store/notifications';
import { useAuth } from '@/store/auth';
import { waiterVoice } from '@/services/waiterVoice';
import type { Order } from '@/types';

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
    const notifyWaiter = () => {
      invalidateOrders();
      push({ message: 'Статус заказа обновлён', type: 'info', at: new Date().toISOString() });
      void beep('notify');
    };
    const notifyReceiptAccepted = () => {
      invalidateOrders();
      push({ message: 'Печать чека подтверждена', type: 'success', at: new Date().toISOString() });
      void beep('accept');
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
      invalidateOrders();
      speakWaiterOrder(order);
    };
    const onWaiterOrderChanged = (order: VoicedOrder) => {
      notifyWaiter();
      speakWaiterOrder(order);
    };

    const handlers: Array<[string, () => void]> = [
      [SERVER_EVENTS.ORDER_NEW, invalidateOrders],
      [SERVER_EVENTS.KITCHEN_NEW_ORDER, invalidateOrders],
      [SERVER_EVENTS.WAITER_SHIFT_STARTED, invalidateOrders],
      [SERVER_EVENTS.WAITER_SHIFT_ENDED, invalidateOrders],
      [SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, notifyReceiptAccepted],
      [SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, notifyReceiptAccepted],
      [SERVER_EVENTS.TABLE_STATUS_CHANGED, invalidateTables],
      [SERVER_EVENTS.TABLES_UPDATED, invalidateTables],
      [SERVER_EVENTS.MENU_UPDATED, invalidateMenu],
    ];

    handlers.forEach(([event, fn]) => sock.on(event, fn));
    sock.on(SERVER_EVENTS.ORDER_STATUS_CHANGED, onOrderStatusChanged);
    sock.on(SERVER_EVENTS.WAITER_ORDER_READY, onWaiterOrderChanged);
    sock.on(SERVER_EVENTS.WAITER_ORDER_REJECTED, onWaiterOrderChanged);

    // При восстановлении соединения — обновляем активные данные.
    const onReconnect = () => {
      invalidateOrders();
      invalidateTables();
    };
    sock.on('connect', onReconnect);

    return () => {
      handlers.forEach(([event, fn]) => sock.off(event, fn));
      sock.off(SERVER_EVENTS.ORDER_STATUS_CHANGED, onOrderStatusChanged);
      sock.off(SERVER_EVENTS.WAITER_ORDER_READY, onWaiterOrderChanged);
      sock.off(SERVER_EVENTS.WAITER_ORDER_REJECTED, onWaiterOrderChanged);
      sock.off('connect', onReconnect);
    };
  }, [push, qc, userId]);
}
