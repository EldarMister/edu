export type Role = 'WAITER' | 'KITCHEN' | 'ADMIN' | 'OWNER';

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export type TableStatus =
  | 'free'
  | 'occupied'
  | 'sent_to_kitchen'
  | 'accepted'
  | 'cooking'
  | 'ready'
  | 'served'
  | 'waiting_payment'
  | 'paid';

export interface TableItem {
  id: string;
  number: number;
  seats: number;
  status: TableStatus;
  hallId: string;
}

export interface Hall {
  id: string;
  name: string;
  tables: TableItem[];
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export type DiscountType = 'none' | 'percent' | 'fixed';

export interface Dish {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: string; // Decimal приходит строкой
  imageUrl: string | null;
  discountType: DiscountType;
  discountValue: string;
  isAvailable: boolean;
}

export type OrderStatus =
  | 'draft'
  | 'sent_to_kitchen'
  | 'accepted_by_kitchen'
  | 'cooking'
  | 'ready'
  | 'picked_up'
  | 'served'
  | 'waiting_payment'
  | 'paid'
  | 'rejected'
  | 'partially_rejected'
  | 'cancelled';

export type OrderItemStatus =
  | 'new'
  | 'accepted'
  | 'cooking'
  | 'ready'
  | 'rejected'
  | 'served'
  | 'cancelled';

export type PaymentMethod = 'qr' | 'cash' | 'card';

export type WaiterShiftStatus = 'active' | 'closed';

export interface WaiterShift {
  id: string;
  waiterId: string;
  startedAt: string;
  endedAt: string | null;
  status: WaiterShiftStatus;
  createdAt: string;
  updatedAt: string;
  stats?: {
    ordersCount: number;
    totalAmount: string;
    activeOrdersCount: number;
  };
}

export interface OrderItem {
  id: string;
  dishId: string;
  dishNameSnapshot: string;
  priceSnapshot: string;
  quantity: number;
  discountAmount: string;
  finalPrice: string;
  status: OrderItemStatus;
  comment: string | null;
  rejectReason: string | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string;
  discountAmount: string;
  finalAmount: string;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  createdAt: string;
  table: { id: string; number: number; seats: number; hallId: string; status: TableStatus };
  waiter: { id: string; name: string };
  items: OrderItem[];
}

export interface Receipt {
  cafeName: string;
  address?: string;
  phone?: string;
  phone2?: string;
  orderNumber: string;
  tableNumber: number;
  waiter: string;
  date: string;
  items: {
    dishNameSnapshot: string;
    quantity: number;
    priceSnapshot: string;
    finalPrice: string;
  }[];
  totalAmount: string;
  discountAmount: string;
  finalAmount: string;
  paymentMethod: PaymentMethod | null;
  thanks: string;
}

/** Локальная позиция корзины (до отправки на кухню). */
export interface CartLine {
  dish: Dish;
  quantity: number;
  comment?: string;
}

export interface AppNotification {
  id: string;
  message: string;
  orderId?: string;
  orderNumber?: string;
  at: string;
}
