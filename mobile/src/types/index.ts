/**
 * DTO-типы, совместимые с backend EDU POS (зеркало frontend/src/types).
 * Согласно ТЗ §22: временно держим типы в mobile, следим за совместимостью с backend.
 */
export type Role = 'WAITER' | 'KITCHEN' | 'BAR' | 'ADMIN' | 'OWNER';

/** Направление приготовления/выдачи позиции. `none` — без отправки (официант забирает сам). */
export type PrepStation = 'kitchen' | 'bar' | 'none';

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
  occupiedBy?: { id: string; name: string } | null;
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
  prepStation?: PrepStation;
}

export type DiscountType = 'none' | 'percent' | 'fixed';

export interface DishVariant {
  id: string;
  name: string;
  price: string;
  sortOrder: number;
  stock?: number;
  minStock?: number;
  unit?: string;
}

export interface Dish {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  discountType: DiscountType;
  discountValue: string;
  isAvailable: boolean;
  trackInventory?: boolean;
  stock?: number;
  minStock?: number;
  unit?: string;
  prepStation?: PrepStation | null;
  isSet?: boolean;
  setComponents?: SetComponentDef[];
  variants: DishVariant[];
}

export interface SetComponentDef {
  id: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
  dishVariantId?: string | null;
  dish: { id: string; name: string; price: string };
  dishVariant?: { id: string; name: string; price: string } | null;
}

export type SetComponentAction = 'default' | 'removed' | 'replaced';

export interface OrderSetComponent {
  id: string;
  action: SetComponentAction;
  status: OrderItemStatus;
  rejectReason?: string | null;
  originalDishId: string | null;
  originalNameSnapshot: string;
  originalVariantNameSnapshot?: string | null;
  finalDishId: string | null;
  finalNameSnapshot: string | null;
  quantity: number;
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

/** Тип печати: обычный (финальный) чек или счёт. */
export type ReceiptPrintType = 'receipt' | 'preliminary';

export type PaymentMethod = 'qr' | 'cash' | 'card' | 'mixed';
export type PaymentSource = 'normal' | 'split';
export type RejectionDecision = 'pending' | 'removed' | 'replaced';

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
  dishId: string | null;
  dishVariantId: string | null;
  dishNameSnapshot: string;
  dishVariantNameSnapshot: string | null;
  priceSnapshot: string;
  quantity: number;
  discountAmount: string;
  finalPrice: string;
  status: OrderItemStatus;
  prepStation: PrepStation;
  comment: string | null;
  takeaway?: boolean;
  rejectReason: string | null;
  rejectionDecision?: RejectionDecision | null;
  replacementForItemId?: string | null;
  setComponents?: OrderSetComponent[];
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string;
  discountAmount: string;
  serviceChargeAmount: string;
  finalAmount: string;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  requiresWaiterDecision: boolean;
  createdAt: string;
  table: {
    id: string;
    number: number;
    seats: number;
    hallId: string;
    status: TableStatus;
    hall?: { name: string };
  };
  waiter: { id: string; name: string } | null;
  source?: 'waiter' | 'qr';
  items: OrderItem[];
  payments?: { method: PaymentMethod; amount: string; source?: PaymentSource }[];
  fiscalReceiptNumber?: string | null;
  fiscalSign?: string | null;
  fiscalQrCode?: string | null;
  fiscalError?: string | null;
  fiscalizedAt?: string | null;
}

export interface Receipt {
  cafeName: string;
  address?: string | null;
  phone?: string | null;
  phone2?: string | null;
  instagram?: string | null;
  website?: string | null;
  orderNumber: string;
  tableNumber: number;
  waiter: string;
  date: string;
  items: {
    dishNameSnapshot: string;
    dishVariantNameSnapshot?: string | null;
    quantity: number;
    priceSnapshot: string;
    finalPrice: string;
  }[];
  totalAmount: string;
  discountAmount: string;
  serviceChargeAmount: string;
  finalAmount: string;
  paymentMethod: PaymentMethod | null;
  payments?: { method: PaymentMethod; amount: string; source?: PaymentSource }[];
  thanks: string;
}

export type ReceiptPrintStatus = 'pending' | 'approved' | 'rejected' | 'printed';

export interface ReceiptPrintRequest {
  id: string;
  source?: 'request' | 'order';
  priority?: boolean;
  orderId: string;
  orderNumber: string;
  tableNumber: number;
  type: ReceiptPrintType;
  waiterId: string;
  waiterName: string;
  amount: string;
  status: ReceiptPrintStatus | null;
  createdAt: string;
  decidedAt?: string | null;
  voice?: { text?: string | null } | null;
}

/** Компонент сета в корзине (с применённым изменением). */
export interface CartSetComponent {
  componentId: string;
  originalDishId: string;
  originalVariantId?: string;
  originalName: string;
  originalPrice: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
  action: SetComponentAction;
  finalDishId?: string;
  finalName?: string;
  finalPrice?: string;
}

/** Локальная позиция корзины (до отправки на кухню). */
export interface CartLine {
  dish: Dish;
  variant?: DishVariant;
  quantity: number;
  comment?: string;
  takeaway?: boolean;
  lineId?: string;
  set?: { components: CartSetComponent[] };
}
