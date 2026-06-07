/**
 * Имена real-time событий и комнат Socket.IO.
 * Соответствуют ТЗ §22 (раздел «С сервера клиентам»).
 */
export const ROOMS = {
  KITCHEN: 'role:kitchen',
  ADMIN: 'role:admin',
  ADMIN_ONLY: 'role:admin-only',
  waiter: (waiterId: string) => `waiter:${waiterId}`,
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
  MENU_UPDATED: 'menu:updated',
  NOTIFICATION_NEW: 'notification:new',
  // Печать чека: официант ⇄ администратор.
  RECEIPT_PRINT_REQUEST_CREATED: 'receipt_print_request_created',
  RECEIPT_PRINT_REQUEST_APPROVED: 'receipt_print_request_approved',
  RECEIPT_PRINT_REQUEST_REJECTED: 'receipt_print_request_rejected',
  RECEIPT_PRINT_REQUEST_PRINTED: 'receipt_print_request_printed',
} as const;
