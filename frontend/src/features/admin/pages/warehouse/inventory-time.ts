export type InventoryTiming = { mode: 'current' | 'past'; local: string };
const timezone = 'Asia/Bishkek';
const wallClock = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const displayClock = new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });

export function inventoryLocalTime(value: string | Date = new Date()) {
  const parts = wallClock.formatToParts(typeof value === 'string' ? new Date(value) : value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function inventoryTimeDisplay(value: string) { return displayClock.format(new Date(value)); }

/** Convert a Bishkek wall time to an instant without using the browser's local timezone. */
export function inventoryTimeIso(local: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 1900 || hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(wallMs);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  let instant = wallMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = inventoryLocalTime(new Date(instant));
    const observedMs = Date.parse(`${observed}:00Z`);
    instant += wallMs - observedMs;
  }
  const result = new Date(instant).toISOString();
  return inventoryLocalTime(result) === local ? result : undefined;
}

export function inventoryTimingFor(countedAt?: string | null): InventoryTiming {
  return { mode: countedAt ? 'past' : 'current', local: inventoryLocalTime(countedAt ?? new Date()) };
}

export function inventoryTimingValue(timing: InventoryTiming, savedCountedAt?: string | null): string | null | undefined {
  if (timing.mode === 'current') return null;
  // Do not discard seconds from an existing timestamp merely by opening its minute-based editor.
  if (savedCountedAt && inventoryLocalTime(savedCountedAt) === timing.local) return savedCountedAt;
  return inventoryTimeIso(timing.local);
}

export function inventoryTimingError(timing: InventoryTiming, now = new Date(), operation = false): string {
  if (timing.mode === 'current') return '';
  const instant = inventoryTimeIso(timing.local);
  if (!instant) return operation ? 'Укажите дату и время складской операции.' : 'Укажите дату и время фактического подсчёта.';
  if (Date.parse(instant) <= now.getTime()) return '';
  return operation ? 'Дата складской операции не может быть в будущем.' : 'Дата проверки не может быть в будущем.';
}
