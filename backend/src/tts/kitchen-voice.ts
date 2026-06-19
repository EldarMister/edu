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
  prepStation?: 'kitchen' | 'bar' | 'none' | string | null;
  quantity?: number | null;
  dishNameSnapshot: string;
  dishVariantNameSnapshot?: string | null;
  dishVoiceSnapshot?: string | null;
  setComponents?: {
    action: string;
    status: string;
    originalNameSnapshot: string;
    finalNameSnapshot?: string | null;
    quantity?: number | null;
  }[];
};

type VoiceOrder = {
  orderNumber: string;
  items: VoiceItem[];
};

type VoiceStation = 'kitchen' | 'bar';

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
  const name = v && v.length > 0 ? v : item.dishNameSnapshot;
  return withVariantVoice(name, item.dishVariantNameSnapshot);
}

function decimalNumberVoice(raw: string): string {
  const normalized = raw.replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return raw;
  if (Number.isInteger(value)) return numberToWordsRu(value);

  const [wholeRaw, fractionRaw = ''] = normalized.split('.');
  const whole = Number(wholeRaw);
  const fraction = fractionRaw.replace(/0+$/, '') || '0';
  const fractionNumber = Number(fraction);
  const denominator =
    fraction.length === 1 ? 'десятых' :
      fraction.length === 2 ? 'сотых' :
        'тысячных';
  return `${numberToWordsRu(whole)} целых ${numberToWordsRu(fractionNumber)} ${denominator}`;
}

function unitKey(rawUnit: string): 'kg' | 'g' | 'l' | 'ml' | 'pcs' | null {
  const unit = rawUnit.trim().toLowerCase().replace(/\./g, '');
  if (unit === 'кг' || unit === 'kg' || unit === 'килограмм' || unit === 'килограмма' || unit === 'килограммов') {
    return 'kg';
  }
  if (unit === 'г' || unit === 'гр' || unit === 'g' || unit === 'грамм' || unit === 'грамма' || unit === 'граммов') {
    return 'g';
  }
  if (unit === 'л' || unit === 'l' || unit === 'литр' || unit === 'литра' || unit === 'литров') {
    return 'l';
  }
  if (unit === 'мл' || unit === 'ml' || unit === 'миллилитр' || unit === 'миллилитра' || unit === 'миллилитров') {
    return 'ml';
  }
  if (unit === 'шт' || unit === 'штук' || unit === 'штука' || unit === 'штуки') return 'pcs';
  return null;
}

function pluralUnit(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function unitVoice(rawUnit: string, amount?: number): string {
  const key = unitKey(rawUnit);
  if (!key) return rawUnit.trim();
  const n = amount ?? 1;
  if (key === 'kg') return pluralUnit(n, 'килограмм', 'килограмма', 'килограммов');
  if (key === 'g') return pluralUnit(n, 'грамм', 'грамма', 'грамм');
  if (key === 'l') return pluralUnit(n, 'литр', 'литра', 'литров');
  if (key === 'ml') return pluralUnit(n, 'миллилитр', 'миллилитра', 'миллилитров');
  if (key === 'pcs') return pluralUnit(n, 'штука', 'штуки', 'штук');
  return rawUnit.trim();
}

function variantVoice(variant?: string | null): string {
  const raw = variant?.trim();
  if (!raw) return '';

  // "1кг", "1 кг", "0.5 л", "500мл" → понятная фраза для TTS.
  const amountUnit = raw.match(/^(\d+(?:[.,]\d+)?)\s*([^\d\s].*)$/u);
  if (amountUnit) {
    const amount = Number(amountUnit[1].replace(',', '.'));
    const key = unitKey(amountUnit[2]);
    if (amount === 0.5 && key === 'kg') return 'пол килограмма';
    if (amount === 0.5 && key === 'l') return 'пол литра';
    return `${decimalNumberVoice(amountUnit[1])} ${unitVoice(amountUnit[2], amount)}`;
  }

  return raw;
}

function withVariantVoice(name: string, variant?: string | null): string {
  const v = variantVoice(variant);
  return v ? `${name}. ${v}` : name;
}

/**
 * Правки произношения: некоторые слова синтезатор читает неестественно.
 * Применяется к финальному тексту озвучки.
 */
const PRONUNCIATION: [RegExp, string][] = [
  [/Мясной/gi, 'Мяснойй'],
];
function applyPronunciation(text: string): string {
  return PRONUNCIATION.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

/** Признак позиции-сета: есть компоненты состава. */
function isSetItem(item: VoiceItem): boolean {
  return (item.setComponents?.length ?? 0) > 0;
}

/**
 * Озвучиваемое имя сета: voiceName, если задано, иначе «Сет-7» → «Сет номер семь»
 * (дефис с числом плохо читается синтезатором).
 */
function setHeadVoice(item: VoiceItem): string {
  const explicit = item.dishVoiceSnapshot?.trim();
  if (explicit) return withVariantVoice(explicit, item.dishVariantNameSnapshot);
  const name = item.dishNameSnapshot.trim();
  const m = name.match(/^(.*\S)[\s-]+(\d{1,4})$/);
  const setName = m ? `${m[1]} номер ${numberToWordsRu(Number(m[2]))}` : name;
  return withVariantVoice(setName, item.dishVariantNameSnapshot);
}

/**
 * Озвучка одной позиции. Обычное блюдо — его имя; сет — имя + ИТОГОВЫЙ состав,
 * где заменённые компоненты дают финальное блюдо, а одинаковые суммируются
 * («два Запечённый филадельфия»). Убранные компоненты проговариваются отдельно.
 */
function itemVoiceFragment(item: VoiceItem): string {
  if (!isSetItem(item)) {
    const qty = item.quantity && item.quantity > 1 ? `${numberToWordsRu(item.quantity)} ` : '';
    return `${qty}${dishVoice(item)}`;
  }

  const components = item.setComponents ?? [];
  const alive = (c: { status: string; action: string }) =>
    c.status !== 'rejected' && c.status !== 'cancelled' && c.action !== 'removed';

  // Итоговый состав: имя финального блюда → суммарное количество (в порядке появления).
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const c of components) {
    if (!alive(c)) continue;
    const name = (c.action === 'replaced' && c.finalNameSnapshot ? c.finalNameSnapshot : c.originalNameSnapshot).trim();
    if (!name) continue;
    const qty = c.quantity && c.quantity > 0 ? c.quantity : 1;
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + qty);
  }

  const setQty = item.quantity && item.quantity > 1 ? `${numberToWordsRu(item.quantity)} ` : '';
  const parts: string[] = [`${setQty}${setHeadVoice(item)}. Состав`];
  for (const name of order) {
    const n = counts.get(name)!;
    parts.push(n > 1 ? `${numberToWordsRu(n)} ${name}` : name);
  }
  // Убранные компоненты — отдельно.
  for (const c of components) {
    const removed = c.action === 'removed' || c.status === 'rejected' || c.status === 'cancelled';
    if (!removed) continue;
    const n = c.originalNameSnapshot.trim();
    if (n) parts.push(`убрали ${n}`);
  }
  return parts.join('. ');
}

/** Блюда заказа (без отказанных/отменённых) для озвучки. */
function activeDishNames(order: VoiceOrder, station: VoiceStation = 'kitchen'): string[] {
  return order.items
    .filter((it) => it.prepStation === station && it.status !== 'rejected' && it.status !== 'cancelled')
    .map(itemVoiceFragment)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «Новый заказ. Номер пятьдесят четыре. Состав заказа: борщ. Маргарита. …» */
export function buildNewOrderText(order: VoiceOrder, station: VoiceStation = 'kitchen'): string | null {
  const num = orderNumberWords(order.orderNumber);
  const dishes = activeDishNames(order, station);
  if (dishes.length === 0) return null;
  const head = `Новый заказ. Номер ${num}.`;
  return applyPronunciation(`${head} Состав заказа: ${dishes.join('. ')}.`);
}

/** «Заказ номер пятьдесят четыре отменён.» */
export function buildCancelText(order: { orderNumber: string }): string {
  return `Заказ номер ${orderNumberWords(order.orderNumber)} отменён.`;
}

/** «Заказ номер пятьдесят четыре изменён. Проверьте состав заказа.» */
export function buildChangedText(order: { orderNumber: string }): string {
  return `Заказ номер ${orderNumberWords(order.orderNumber)} изменён. Проверьте состав заказа.`;
}

export function buildReplacementText(orderNumber: string, oldName: string, newName: string): string {
  return applyPronunciation(`Заказ номер ${orderNumberWords(orderNumber)}. Заменили ${oldName} на ${newName}.`);
}

/** Озвучиваемое имя блюда позиции для диффа изменений. */
function diffVoiceName(it: VoiceItem): string {
  return dishVoice(it);
}

function diffActiveNames(item: VoiceItem): string[] {
  const components = item.setComponents ?? [];
  if (components.length === 0) return [diffVoiceName(item)];

  return components
    .filter((c) => c.status !== 'rejected' && c.status !== 'cancelled' && c.action !== 'removed')
    .map((c) => (c.action === 'replaced' && c.finalNameSnapshot ? c.finalNameSnapshot : c.originalNameSnapshot))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Текст озвучки изменения заказа с конкретикой: что заменили / убрали / добавили.
 * «Заказ номер N. Заменили борщ на солянку.» / «… Отменили колу.» / «… Добавили чай.»
 */
export function buildEditVoiceText(
  orderNumber: string,
  before: VoiceItem[],
  after: VoiceItem[],
  station: VoiceStation = 'kitchen',
): string | null {
  const head = `Заказ номер ${orderNumberWords(orderNumber)}.`;
  const count = (items: VoiceItem[]) => {
    const m = new Map<string, number>();
    for (const it of items) {
      if (it.prepStation !== station) continue;
      if (it.status === 'rejected' || it.status === 'cancelled') continue;
      for (const name of diffActiveNames(it)) {
        m.set(name, (m.get(name) ?? 0) + 1);
      }
    }
    return m;
  };
  const bMap = count(before);
  const aMap = count(after);
  const removed: string[] = [];
  const added: string[] = [];
  for (const name of new Set([...bMap.keys(), ...aMap.keys()])) {
    const delta = (aMap.get(name) ?? 0) - (bMap.get(name) ?? 0);
    if (delta > 0) added.push(name);
    else if (delta < 0) removed.push(name);
  }
  if (removed.length === 0 && added.length === 0) {
    return null;
  }
  // Ровно одно убрали и одно добавили — это замена блюда.
  if (removed.length === 1 && added.length === 1) {
    return applyPronunciation(`${head} Заменили ${removed[0]} на ${added[0]}.`);
  }
  const parts: string[] = [];
  if (removed.length) parts.push(`Отменили ${removed.join('. ')}`);
  if (added.length) parts.push(`Добавили ${added.join('. ')}`);
  return applyPronunciation(`${head} ${parts.join('. ')}.`);
}
