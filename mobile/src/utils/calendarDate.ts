/** Calendar dates stay in local time: UTC conversion can change the selected day. */
function localNoon(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  // The numeric Date constructor interprets years 0–99 as 1900–1999.
  date.setFullYear(year, month, day);
  return date;
}

function daysInMonth(year: number, month: number): number {
  if (month === 1) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
}

function parsedDate(year: number, month: number, day: number): Date | null {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1)) return null;
  const date = localNoon(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function dateToIso(date: Date): string {
  const year = date.getFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) return '';
  return `${String(year).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseIsoDate(iso: string): Date | null {
  if (iso.length !== 10) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? parsedDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

export function parseDisplayDate(text: string): Date | null {
  if (text.length !== 10) return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  return match ? parsedDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

export function displayDate(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return '';
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).padStart(4, '0')}`;
}

export function calendarMonth(iso: string, fallback: Date = new Date()): Date {
  const selected = parseIsoDate(iso);
  const source = selected ?? (Number.isFinite(fallback.getTime()) ? fallback : new Date());
  const year = Math.max(1, Math.min(9999, source.getFullYear()));
  return localNoon(year, source.getMonth(), 1);
}

export function shiftCalendarMonth(month: Date, delta: number): Date {
  const first = calendarMonth('', month);
  const offset = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  const target = Math.max(12, Math.min(9999 * 12 + 11, first.getFullYear() * 12 + first.getMonth() + offset));
  return localNoon(Math.floor(target / 12), target % 12, 1);
}

export function calendarCells(month: Date): Array<{ date: Date; iso: string; outside: boolean }> {
  const first = calendarMonth('', month);
  const year = first.getFullYear();
  const monthIndex = first.getMonth();
  const leading = (first.getDay() + 6) % 7;
  const length = Math.ceil((leading + daysInMonth(year, monthIndex)) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const date = localNoon(year, monthIndex, index + 1 - leading);
    return { date, iso: dateToIso(date), outside: date.getFullYear() !== year || date.getMonth() !== monthIndex };
  });
}

export function isAllowedDate(iso: string, minimum?: string, maximum?: string): boolean {
  if (!parseIsoDate(iso)) return false;
  if (minimum && (!parseIsoDate(minimum) || iso < minimum)) return false;
  if (maximum && (!parseIsoDate(maximum) || iso > maximum)) return false;
  return true;
}
