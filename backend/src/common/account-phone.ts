export const ACCOUNT_PHONE_ERROR = 'Введите 9 цифр после +996 или 10 цифр после +7.';

export function normalizeAccountPhone(value: string) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s().-]/g, '');
  if (/^\+?(?:996\d{9}|7\d{10})$/.test(compact)) return compact.startsWith('+') ? compact : '+' + compact;
  if (/^8\d{10}$/.test(compact)) return '+7' + compact.slice(1);
  if (/^0?\d{9}$/.test(compact)) return '+996' + compact.slice(-9);
  return null;
}

export function accountPhoneAliases(phone: string) {
  if (phone.startsWith('+996')) {
    const local = phone.slice(4);
    return [phone, phone.slice(1), local, '0' + local];
  }
  return [phone, phone.slice(1), '8' + phone.slice(2)];
}
