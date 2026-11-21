export function dateToIso(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dateToDisplay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function parseDateDisplay(value: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return year > 0 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function validateDateInput(
  text: string,
  { min = '', max = '', required = false }: { min?: string; max?: string; required?: boolean } = {},
): { value?: string; error?: 'required' | 'format' | 'min' | 'max' } {
  if (!text) return required ? { error: 'required' } : { value: '' };
  const parsed = parseDateDisplay(text);
  if (!parsed) return { error: 'format' };
  const value = dateToIso(parsed);
  if (min && value < min) return { error: 'min' };
  if (max && value > max) return { error: 'max' };
  return { value };
}

export function isCompleteTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Incomplete native time input must not clear the last valid date/time. */
export function nextDateTimeForTime(value: string, time: string, today: string): string | undefined {
  if (!isCompleteTime(time)) return undefined;
  const date = value.split('T')[0] || today;
  if (!parseDateDisplay(dateToDisplay(date))) return undefined;
  return `${date}T${time}`;
}
