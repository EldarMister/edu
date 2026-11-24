export function salePrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.').replace(/^0+(?=\d)/, '');
  if (!/^(?:\d{1,8}(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return null;
  return Number(normalized);
}
