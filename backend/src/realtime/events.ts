/**
 * Имена real-time событий и комнат Socket.IO.
 * Соответствуют ТЗ §22 (раздел «С сервера клиентам»).
 */
export const ROOMS = {
  KITCHEN: 'role:kitchen',
  ADMIN: 'role:admin',
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
  NOTIFICATION_NEW: 'notification:new',
} as const;
