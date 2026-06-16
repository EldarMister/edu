/** Русская плюрализация. */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (d > 1 && d < 5) return forms[1];
  if (d === 1) return forms[0];
  return forms[2];
}

export const pluralItems = (n: number) => `${n} ${plural(n, ['позиция', 'позиции', 'позиций'])}`;
export const pluralGuests = (n: number) => `${n} ${plural(n, ['гость', 'гостя', 'гостей'])}`;
