import type { PeriodPreset } from './ReportPeriodFilter';

const warehouseCalendar = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bishkek',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function warehouseDay(date = new Date()) {
  const parts = warehouseCalendar.formatToParts(date);
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

export function calendarDate(day: Date, offset = 0) {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

export function warehousePeriodRange(preset: PeriodPreset, today: Date, customFrom: string, customTo: string): {
  dateFrom?: string;
  dateTo?: string;
} {
  if (preset === 'custom') return { dateFrom: customFrom, dateTo: customTo };
  if (preset === 'all') return {};
  if (preset === 'lastWeek' || preset === 'lastTwoWeeks') {
    const sinceMonday = (today.getUTCDay() + 6) % 7;
    return {
      dateFrom: calendarDate(today, -sinceMonday - (preset === 'lastTwoWeeks' ? 14 : 7)),
      dateTo: calendarDate(today, -sinceMonday - 1),
    };
  }
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  if (preset === 'lastMonth') {
    return {
      dateFrom: calendarDate(new Date(Date.UTC(year, month - 1, 1))),
      dateTo: calendarDate(new Date(Date.UTC(year, month, 0))),
    };
  }
  if (preset === 'currentMonth') {
    return { dateFrom: calendarDate(new Date(Date.UTC(year, month, 1))), dateTo: calendarDate(today) };
  }
  if (preset === 'yesterday') {
    const yesterday = calendarDate(today, -1);
    return { dateFrom: yesterday, dateTo: yesterday };
  }
  const daysBefore = preset === 'month' ? 29 : preset === 'twoWeeks' ? 13 : preset === 'week' ? 6 : 0;
  return { dateFrom: calendarDate(today, -daysBefore), dateTo: calendarDate(today) };
}
