/**
 * Формирование текста для озвучки кухни (ТЗ §4, §5, §7).
 *
 * Правила:
 *  - между частями и блюдами — точки (спокойная, понятная речь);
 *  - номер заказа — прописью («пятьдесят четыре»);
 *  - для блюда используется voiceName/pronunciationName, если задано, иначе обычное название;
 *  - стол НЕ озвучиваем;
 *  - ничего лишнего для повара.
 */

type VoiceItem = {
  status: string;
  dishNameSnapshot: string;
  dishVoiceSnapshot?: string | null;
};

type VoiceOrder = {
  orderNumber: string;
  items: VoiceItem[];
};

const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function under1000(n: number): string {
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

/** Число прописью (для номера заказа), поддерживает 0..9999. */
export function numberToWordsRu(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return UNITS[0];
  if (n < 1000) return under1000(n);
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  // Склонение «тысяча»: 1 — одна тысяча, 2-4 — две тысячи, 5+ — пять тысяч.
  const thLastTwo = th % 100;
  const thLast = th % 10;
  let thWord = 'тысяч';
  if (thLast === 1 && thLastTwo !== 11) thWord = 'тысяча';
  else if (thLast >= 2 && thLast <= 4 && !(thLastTwo >= 12 && thLastTwo <= 14)) thWord = 'тысячи';
  // 1 → «одна», 2 → «две» (женский род для тысяч).
  let thNum = under1000(th);
  if (thLast === 1 && thLastTwo !== 11) thNum = thNum.replace(/один$/, 'одна');
  if (thLast === 2 && thLastTwo !== 12) thNum = thNum.replace(/два$/, 'две');
  return [thNum, thWord, rest ? under1000(rest) : ''].filter(Boolean).join(' ');
}

/** Номер заказа («№54» / «54») прописью; нечисловой — как есть. */
export function orderNumberWords(orderNumber: string): string {
  const digits = (orderNumber ?? '').replace(/\D+/g, '');
  if (!digits) return (orderNumber ?? '').trim();
  return numberToWordsRu(Number(digits));
}

/** Озвучиваемое имя блюда: voiceName, если задано, иначе обычное название. */
function dishVoice(item: VoiceItem): string {
  const v = item.dishVoiceSnapshot?.trim();
  return v && v.length > 0 ? v : item.dishNameSnapshot;
}

/** Блюда заказа (без отказанных/отменённых) для озвучки. */
function activeDishNames(order: VoiceOrder): string[] {
  return order.items
    .filter((it) => it.status !== 'rejected' && it.status !== 'cancelled')
    .map(dishVoice)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «Новый заказ. Номер пятьдесят четыре. Состав заказа: борщ. Маргарита. …» */
export function buildNewOrderText(order: VoiceOrder): string {
  const num = orderNumberWords(order.orderNumber);
  const dishes = activeDishNames(order);
  const head = `Новый заказ. Номер ${num}.`;
  if (dishes.length === 0) return head;
  return `${head} Состав заказа: ${dishes.join('. ')}.`;
}

/** «Заказ номер пятьдесят четыре отменён.» */
export function buildCancelText(order: { orderNumber: string }): string {
  return `Заказ номер ${orderNumberWords(order.orderNumber)} отменён.`;
}

/** «Заказ номер пятьдесят четыре изменён. Проверьте состав заказа.» */
export function buildChangedText(order: { orderNumber: string }): string {
  return `Заказ номер ${orderNumberWords(order.orderNumber)} изменён. Проверьте состав заказа.`;
}
