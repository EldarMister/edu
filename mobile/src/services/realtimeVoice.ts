import type { Order, PrepStation } from '@/types';

export type WaiterVoicedOrder = Order & {
  voice?: { text?: string | null; waiterText?: string | null } | null;
};

export type StationVoicedOrder = Order & {
  voice?: {
    text?: string | null;
    byStation?: Partial<Record<Exclude<PrepStation, 'none'>, string | null>>;
  } | null;
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

export function waiterLocationText(order: Order): string {
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

function uniqueNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function componentName(component: NonNullable<Order['items'][number]['setComponents']>[number]): string {
  return component.action === 'replaced' && component.finalNameSnapshot
    ? component.finalNameSnapshot
    : component.originalNameSnapshot;
}

function itemNamesByStatus(order: Order, statuses: Order['items'][number]['status'][]): string[] {
  const wanted = new Set(statuses);
  const names: string[] = [];
  for (const item of order.items ?? []) {
    if (wanted.has(item.status)) names.push(itemName(item));
    for (const component of item.setComponents ?? []) {
      if (wanted.has(component.status)) names.push(componentName(component));
    }
  }
  return uniqueNames(names);
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
  return uniqueNames(names);
}

function voiceItemsKey(order: Order): string {
  return (order.items ?? [])
    .flatMap((item) => [
      `${item.id}:${item.status}`,
      ...(item.setComponents ?? []).map((component) => `${component.id}:${component.status}`),
    ])
    .join('|');
}

export function waiterVoiceText(order: WaiterVoicedOrder): string | null {
  if (order.voice?.waiterText) return order.voice.waiterText;

  const location = waiterLocationText(order);
  const readyNames = itemNamesByStatus(order, ['ready']);
  const readyText = readyNames.length ? `Готово: ${readyNames.join(', ')}. ` : '';
  const cancelledNames = itemNamesByStatus(order, ['cancelled']);
  const cancelledText = cancelledNames.length ? `: ${cancelledNames.join(', ')}` : '';
  const rejectedNames = rejectedDishNames(order);
  const rejectedText = rejectedNames.length ? `: ${rejectedNames.join(', ')}` : '';
  switch (order.status) {
    case 'cooking':
    case 'accepted_by_kitchen':
      return readyNames.length ? `${readyText}${location} Заберите.` : `Кухня приняла ваш заказ. ${location}`;
    case 'ready':
      return readyNames.length ? `${readyText}${location} Заберите.` : `Ваш заказ готов. ${location} Заберите.`;
    case 'cancelled':
      return `Заказ отменён${cancelledText}. ${location}`;
    case 'rejected':
      return `Кухня отказала${rejectedText}. ${location}`;
    case 'partially_rejected':
      return `Кухня отказала блюдо${rejectedText}. ${location}`;
    default:
      return cancelledNames.length ? `Отменено${cancelledText}. ${location}` : null;
  }
}

export function waiterVoiceKey(order: WaiterVoicedOrder, text: string | null): string | null {
  if (!text) return null;
  return `${order.status}:${text}:${voiceItemsKey(order)}`;
}

export function stationVoice(order: StationVoicedOrder, station: PrepStation): string | null {
  if (station === 'none') return null;
  return order.voice?.byStation?.[station] ?? order.voice?.text ?? null;
}
