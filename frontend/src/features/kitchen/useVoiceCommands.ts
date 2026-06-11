/**
 * Голосовое управление кухней: разбор распознанных фраз в команды с подтверждением.
 *
 * Команды:
 *  - «принять заказ [номер N]» — принять заказ в работу (с подтверждением);
 *  - «<название блюда> готово» — отметить конкретное блюдо готовым (с подтверждением);
 *  - «повтори заказ» — повторить озвучку последнего заказа;
 *  - «замолчи» / «заткнись» / «тихо» — остановить озвучку.
 *
 * Ограничения (намеренно): голосом нельзя отменить заказ и нельзя отметить готовым
 * весь заказ целиком — только отдельное блюдо. Любое действие требует «да» / «нет».
 */
import { useEffect, useRef, useState } from 'react';
import type { Order } from '@/types';
import { kitchenVoice } from '@/services/kitchenVoice';
import { kitchenVoiceCommands } from '@/services/kitchenVoiceCommands';
import { displayOrderNumber } from '@/lib/format';

type ReadyTarget = { orderId: string; itemIds: string[]; setComponentIds: string[] };
type Pending = { prompt: string; run: () => void };

interface VoiceDeps {
  newOrders: Order[];
  inWorkOrders: Order[];
  onAccept: (orderId: string) => void;
  onReadyItem: (t: ReadyTarget) => void;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();

const YES = ['да', 'ага', 'угу', 'верно', 'подтверждаю', 'подтверждаю', 'точно', 'конечно', 'давай', 'ну да'];
const NO = ['нет', 'не надо', 'отмена', 'отмени', 'неверно', 'не нужно', 'отставить'];
const STOP = ['замолчи', 'заткнись', 'молчи', 'тихо', 'хватит', 'стоп'];

const READY_WORDS = ['готово', 'готова', 'готов', 'готовый'];
const WHOLE_ORDER = ['весь заказ', 'все блюда', 'всё готово', 'все готово', 'заказ готов'];

const UNITS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9,
};
const TEENS: Record<string, number> = {
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
  пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
};
const TENS: Record<string, number> = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90,
};

/** Извлекает номер заказа из фразы: цифрами или словами (до 99). */
function parseSpokenNumber(text: string): number | null {
  const digits = text.match(/\d+/);
  if (digits) return Number(digits[0]);
  const tokens = text.split(' ');
  let value = 0;
  let found = false;
  for (const tk of tokens) {
    if (TEENS[tk] != null) {
      value += TEENS[tk];
      found = true;
    } else if (TENS[tk] != null) {
      value += TENS[tk];
      found = true;
    } else if (UNITS[tk] != null) {
      value += UNITS[tk];
      found = true;
    }
  }
  return found ? value : null;
}

const SELECTABLE = new Set(['new', 'accepted', 'cooking']);

type Candidate = { orderId: string; orderNumber: string; kind: 'item' | 'component'; id: string; name: string };

/** Активные (готовимые) блюда заказов в работе — кандидаты для команды «… готово». */
function collectCandidates(orders: Order[]): Candidate[] {
  const out: Candidate[] = [];
  for (const o of orders) {
    for (const it of o.items) {
      const parts = it.setComponents ?? [];
      if (parts.length > 0) {
        for (const sc of parts) {
          if (!SELECTABLE.has(sc.status)) continue;
          const name = sc.action === 'replaced' ? sc.finalNameSnapshot ?? sc.originalNameSnapshot : sc.originalNameSnapshot;
          out.push({ orderId: o.id, orderNumber: o.orderNumber, kind: 'component', id: sc.id, name });
        }
      } else if (SELECTABLE.has(it.status)) {
        const name = it.dishVariantNameSnapshot
          ? `${it.dishNameSnapshot} ${it.dishVariantNameSnapshot}`
          : it.dishNameSnapshot;
        out.push({ orderId: o.id, orderNumber: o.orderNumber, kind: 'item', id: it.id, name });
      }
    }
  }
  return out;
}

/** Подбор блюда по произнесённой фразе: доля слов фразы, найденных в названии. */
function matchDish(phrase: string, candidates: Candidate[]): Candidate | null {
  const pTokens = norm(phrase).split(' ').filter((w) => w.length >= 3);
  if (pTokens.length === 0) return null;
  let best: Candidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const name = norm(c.name);
    let hit = 0;
    for (const t of pTokens) if (name.includes(t)) hit += 1;
    const score = hit / pTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

export function useVoiceCommands(deps: VoiceDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const pendingRef = useRef<Pending | null>(null);
  const [supported] = useState(() => kitchenVoiceCommands.isSupported);
  const [listening, setListening] = useState(false);
  const [active, setActive] = useState(false);

  // Произнести подсказку, приостановив микрофон, чтобы он не услышал озвучку.
  async function speak(text: string) {
    kitchenVoiceCommands.pause();
    try {
      await kitchenVoice.say(text);
    } catch {
      // озвучка недоступна — продолжаем без неё
    }
    kitchenVoiceCommands.resume();
  }

  function setPending(p: Pending) {
    pendingRef.current = p;
    void speak(p.prompt);
  }
  function clearPending() {
    pendingRef.current = null;
  }

  function handle(raw: string) {
    const text = norm(raw);
    if (!text) return;
    const has = (list: string[]) => list.some((w) => text.includes(w));

    // «замолчи» — всегда останавливает озвучку, вне зависимости от состояния.
    if (has(STOP)) {
      kitchenVoice.stopAll();
      return;
    }
    // «повтори заказ» — повторить последний озвученный заказ.
    if (text.includes('повтор')) {
      if (!kitchenVoice.repeatLast()) void speak('Нечего повторять.');
      return;
    }

    // Ожидание подтверждения «да / нет».
    const pending = pendingRef.current;
    if (pending) {
      if (has(YES)) {
        clearPending();
        pending.run();
      } else if (has(NO)) {
        clearPending();
        void speak('Отменено.');
      }
      return; // пока ждём подтверждения — другие команды не разбираем
    }

    const { newOrders, inWorkOrders, onAccept, onReadyItem } = depsRef.current;

    // «принять заказ» — принять в работу.
    if (text.includes('принять') || text.includes('принимаю')) {
      if (newOrders.length === 0) {
        void speak('Нет новых заказов.');
        return;
      }
      const num = parseSpokenNumber(text);
      const target =
        (num != null && newOrders.find((o) => Number(o.orderNumber.replace(/\D+/g, '')) === num)) ||
        // самый ранний новый заказ
        [...newOrders].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))[0];
      if (!target) {
        void speak('Заказ не найден.');
        return;
      }
      const label = displayOrderNumber(target.orderNumber);
      setPending({
        prompt: `Принять заказ ${label}? Скажите да или нет.`,
        run: () => {
          onAccept(target.id);
          void speak(`Заказ ${label} принят.`);
        },
      });
      return;
    }

    // Голосом нельзя отменить заказ.
    if (text.includes('отмен') || text.includes('отказ')) {
      void speak('Отмену заказа голосом нельзя.');
      return;
    }

    // «… готово» — отметить блюдо готовым.
    if (has(READY_WORDS)) {
      if (has(WHOLE_ORDER)) {
        void speak('Готовность всего заказа голосом недоступна. Назовите блюдо.');
        return;
      }
      // Убираем слова-команды, остаётся название блюда.
      let phrase = text;
      for (const w of [...READY_WORDS, 'заказ', 'блюдо', 'отметь', 'отметить']) {
        phrase = phrase.replace(new RegExp(`\\b${w}\\b`, 'g'), ' ');
      }
      const candidates = collectCandidates(inWorkOrders);
      const match = matchDish(phrase, candidates);
      if (!match) {
        void speak('Блюдо не найдено. Повторите.');
        return;
      }
      const label = displayOrderNumber(match.orderNumber);
      setPending({
        prompt: `Отметить ${match.name}, заказ ${label}, готовым? Да или нет.`,
        run: () => {
          onReadyItem({
            orderId: match.orderId,
            itemIds: match.kind === 'item' ? [match.id] : [],
            setComponentIds: match.kind === 'component' ? [match.id] : [],
          });
          void speak(`${match.name} готово.`);
        },
      });
      return;
    }
  }

  // Регистрируем обработчики один раз.
  useEffect(() => {
    kitchenVoiceCommands.setHandlers(
      (text) => handle(text),
      (isListening) => setListening(isListening),
    );
    return () => {
      kitchenVoiceCommands.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    if (!supported) return;
    if (kitchenVoiceCommands.isActive) {
      kitchenVoiceCommands.stop();
      setActive(false);
      clearPending();
    } else {
      kitchenVoiceCommands.start();
      setActive(true);
      void speak('Голосовое управление включено.');
    }
  }

  return { supported, listening, active, toggle };
}
