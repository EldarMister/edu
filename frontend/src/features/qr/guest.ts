// Идентификатор гостя QR-меню. Без авторизации: случайный ключ в localStorage,
// по нему backend узнаёт устройство в рамках сессии стола.
const KEY = 'edu_menu_guest_key';

export function getGuestKey(): string {
  let k = localStorage.getItem(KEY);
  if (!k) {
    k = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, k);
  }
  return k;
}
