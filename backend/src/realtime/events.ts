/**
 * Имена real-time событий и комнат Socket.IO.
 * Соответствуют ТЗ §22 (раздел «С сервера клиентам»).
 */
export const ROOMS = {
  KITCHEN: 'role:kitchen',
  WAITERS: 'role:waiters',
  ADMIN: 'role:admin',
  ADMIN_ONLY: 'role:admin-only',
  waiter: (waiterId: string) => `waiter:${waiterId}`,
  // Комната QR-меню конкретного стола: все гости стола получают обновления общего заказа.
  qrTable: (tableId: string) => `qr-table:${tableId}`,
};

export const SERVER_EVENTS = {
  ORDER_NEW: 'order:new', // новый заказ ушёл на кухню
  ORDER_STATUS_CHANGED: 'order:status_changed',
  KITCHEN_NEW_ORDER: 'kitchen:new_order',
  WAITER_ORDER_READY: 'waiter:order_ready',
  WAITER_ORDER_REJECTED: 'waiter:order_rejected',
  WAITER_SHIFT_STARTED: 'waiter:shift_started',
  WAITER_SHIFT_ENDED: 'waiter:shift_ended',
  TABLE_STATUS_CHANGED: 'table:status_changed',
  TABLES_UPDATED: 'tables:updated',
  MENU_UPDATED: 'menu:updated',
  SETTINGS_UPDATED: 'settings:updated',
  NOTIFICATION_NEW: 'notification:new',
  // Печать чека: официант ⇄ администратор.
  RECEIPT_PRINT_REQUEST_CREATED: 'receipt_print_request_created',
  RECEIPT_PRINT_REQUEST_APPROVED: 'receipt_print_request_approved',
  RECEIPT_PRINT_REQUEST_REJECTED: 'receipt_print_request_rejected',
  RECEIPT_PRINT_REQUEST_PRINTED: 'receipt_print_request_printed',
  // ККМ: фискальный чек по заказу пробит или вернул ошибку.
  FISCAL_RECEIPT_UPDATED: 'fiscal_receipt_updated',
  // QR-меню стола: realtime для гостей одного стола.
  QR_GUEST_JOINED: 'qr:guest_joined',
  QR_GUEST_LEFT: 'qr:guest_left',
  QR_CART_UPDATED: 'qr:cart_updated',
  QR_ITEM_ADDED: 'qr:item_added',
  QR_ITEM_UPDATED: 'qr:item_updated',
  QR_ITEM_REMOVED: 'qr:item_removed',
  QR_ORDER_SUBMITTED: 'qr:order_submitted',
  QR_ORDER_STATUS_CHANGED: 'qr:order_status_changed',
  // Официант закрыл стол → визит завершён, гости больше не могут заказывать.
  QR_SESSION_CLOSED: 'qr:session_closed',
} as const;

/** Клиентские события, которые шлёт гость QR-меню (вход/выход в комнату стола). */
export const QR_CLIENT_EVENTS = {
  JOIN: 'qr:join',
  LEAVE: 'qr:leave',
} as const;
