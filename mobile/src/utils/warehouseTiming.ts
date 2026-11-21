export type WarehouseLocalTime = { date: string; time: string };
export type WarehouseTiming = WarehouseLocalTime & { mode: 'current' | 'past' };

const timeZone = 'Asia/Bishkek';
const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function warehouseLocalTime(instant: string | Date = new Date()): WarehouseLocalTime {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' };
  const parts = clock.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

export function warehouseTimeDisplay(instant: string): string {
  const { date, time } = warehouseLocalTime(instant);
  return date && time ? `${date.split('-').reverse().join('.')}, ${time}` : '';
}

/** Resolves a wall-clock minute in Bishkek independent of the device timezone. */
export function warehouseDateTimeIso(value: WarehouseLocalTime, saved?: string | null): string | undefined {
  const local = `${value.date}T${value.time}`;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const wallDate = new Date(wallMs);
  if (wallDate.getUTCFullYear() !== year || wallDate.getUTCMonth() !== month - 1 || wallDate.getUTCDate() !== day) return undefined;
  if (saved) {
    const previous = warehouseLocalTime(saved);
    if (previous.date === value.date && previous.time === value.time) return saved;
  }
  let instant = wallMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = warehouseLocalTime(new Date(instant));
    instant += wallMs - Date.parse(`${observed.date}T${observed.time}:00Z`);
  }
  const resolved = warehouseLocalTime(new Date(instant));
  return resolved.date === value.date && resolved.time === value.time ? new Date(instant).toISOString() : undefined;
}

export function warehouseTimingFor(saved?: string | null): WarehouseTiming {
  return { mode: saved ? 'past' : 'current', ...warehouseLocalTime(saved ?? new Date()) };
}

export function warehouseTimingValue(value: WarehouseTiming, saved?: string | null): string | null | undefined {
  return value.mode === 'current' ? null : warehouseDateTimeIso(value, saved);
}

export function warehouseTimingError(value: WarehouseTiming, now = new Date()): string {
  if (value.mode === 'current') return '';
  const instant = warehouseDateTimeIso(value);
  if (!instant) return 'Укажите дату и время складской операции.';
  return Date.parse(instant) > now.getTime() ? 'Дата складской операции не может быть в будущем.' : '';
}

export type WarehousePeriod = 'today' | 'yesterday' | 'week' | 'month' | 'currentMonth' | 'lastMonth' | 'all' | 'custom';

export function warehouseReportRange(period: WarehousePeriod, now = new Date(), custom?: { from: string; to: string }): {
  from?: string;
  to?: string;
} {
  if (period === 'all') return {};
  if (period === 'custom') return custom ?? {};
  const { date } = warehouseLocalTime(now);
  const day = new Date(`${date}T00:00:00Z`);
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth();
  const dayIso = (time: number) => new Date(time).toISOString().slice(0, 10);
  if (period === 'lastMonth') return { from: dayIso(Date.UTC(year, month - 1, 1)), to: dayIso(Date.UTC(year, month, 0)) };
  if (period === 'currentMonth') return { from: dayIso(Date.UTC(year, month, 1)), to: date };
  const daysBefore = { today: 0, yesterday: 1, week: 6, month: 29 }[period];
  const from = dayIso(day.getTime() - daysBefore * 86_400_000);
  return { from, to: period === 'yesterday' ? from : date };
}
