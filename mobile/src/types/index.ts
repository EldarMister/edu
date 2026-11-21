/**
 * DTO-типы, совместимые с backend EDU POS (зеркало frontend/src/types).
 * Согласно ТЗ §22: временно держим типы в mobile, следим за совместимостью с backend.
 */
export type Role = 'WAITER' | 'KITCHEN' | 'BAR' | 'ADMIN' | 'OWNER';

/** Направление приготовления/выдачи позиции. `none` — без отправки (официант забирает сам). */
export type PrepStation = string;

export interface PrepStationEntry {
  id: PrepStation;
  name: string;
  isActive: boolean;
  isBuiltIn: boolean;
}

export type SectionKey =
  | 'statistics'
  | 'finance'
  | 'orders'
  | 'tables'
  | 'menu'
  | 'warehouse'
  | 'staff'
  | 'journal'
  | 'paymentReconciliation'
  | 'checks'
  | 'settings';

export type ActionKey =
  | 'editMenu'
  | 'refundChecks'
  | 'exportReports'
  | 'closeShift'
  | 'financeCashShifts'
  | 'acceptOrderPayments'
  | 'printReceipts'
  | 'requestReceiptPrints'
  | 'createDeliveryOrders'
  | 'manageStaff'
  | 'editPermissions'
  | 'warehouseReceive'
  | 'warehouseTransfer'
  | 'warehouseWriteoff'
  | 'warehouseCount'
  | 'warehouseApprove'
  | 'warehouseRecipes'
  | 'warehouseProduce'
  | 'warehouseCosts'
  | 'warehouseReports'
  | 'warehouseSettings';

export interface EmployeePermissions {
  terminalAccess?: boolean;
  adminAccess?: boolean;
  workShiftRequired?: boolean;
  readOnlySections?: SectionKey[];
  sections: Record<SectionKey, boolean>;
  actions: Record<ActionKey, boolean>;
}

export interface AuthUser {
  access?: { terminal: boolean; admin: boolean; production: 'kitchen' | 'bar' | null };
  positionId?: string | null;
  positionName?: string | null;
  prepStation?: string | null;
  id: string;
  cafeId?: string | null;
  name: string;
  phone: string;
  role: Role;
  /** Итоговые права доступа (приходят с бэкенда). Может отсутствовать у старых сессий. */
  permissions?: EmployeePermissions;
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
  name?: string | null;
  seats: number;
  status: TableStatus;
  hallId: string;
  occupiedBy?: { id: string; name: string } | null;
}

export interface FloorPlanTable {
  tableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'rectangle' | 'round';
  label?: string;
}

export interface Hall {
  id: string;
  name: string;
  useFloorPlan?: boolean | null;
  floorPlan?: FloorPlanTable[] | null;
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
  isWeighted?: boolean;
  weightedMeasure?: 'weight' | 'volume';
  weightedPriceBase?: number;
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
  finalVariantId?: string | null;
  finalNameSnapshot: string | null;
  finalVariantNameSnapshot?: string | null;
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
export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';
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
  weightGrams?: number | null;
  priceSnapshot: string;
  quantity: number;
  discountAmount: string;
  finalPrice: string;
  refundedQuantity?: number;
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
  cafeId?: string | null;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string;
  discountAmount: string;
  serviceChargeAmount: string;
  roundOrderTotal?: boolean;
  finalAmount: string;
  paymentMethod: PaymentMethod | null;
  paymentStatus?: PaymentStatus;
  refundedAmount?: string;
  comment: string | null;
  requiresWaiterDecision: boolean;
  createdAt: string;
  updatedAt?: string;
  stationHistoryAt?: string | null;
  table: {
    id: string;
    number: number;
    seats: number;
    hallId: string;
    status: TableStatus;
    hall?: { name: string };
  };
  waiter: { id: string; name: string } | null;
  source?: 'pos' | 'qr' | 'delivery';
  externalOrderId?: string | null;
  deliveryCustomerName?: string | null;
  deliveryCustomerPhone?: string | null;
  deliveryAddress?: string | null;
  items: OrderItem[];
  payments?: { method: PaymentMethod; amount: string; source?: PaymentSource }[];
  fiscalReceiptNumber?: string | null;
  fiscalSign?: string | null;
  fiscalQrCode?: string | null;
  fiscalError?: string | null;
  fiscalizedAt?: string | null;
}

export type ReceiptLanguage = 'ru' | 'ky';

export interface ReceiptPrintSettings {
  receiptLanguage: ReceiptLanguage;
  receiptPrintCafeName: boolean;
  receiptPrintAddress: boolean;
  receiptPrintPhone: boolean;
}

export type MenuTaxType = 'vat' | 'turnover';
export interface MenuTax {
  id: string;
  name: string;
  rate: string;
  type: MenuTaxType;
}
export interface ReceiptTax extends MenuTax {
  amount: string;
}

export interface Receipt extends Partial<ReceiptPrintSettings> {
  receiptLogoData?: string | null;
  source?: string;
  roundingAmount?: string;
  taxTotal?: string;
  taxes?: ReceiptTax[];
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

/** Вызов администратора при действии, недоступном официанту. */
export interface AdministratorCall {
  orderId: string;
  orderNumber: string;
  hallName: string;
  tableNumber: number;
  waiterId: string;
  waiterName: string;
  createdAt: string;
  message: string;
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
  finalVariantId?: string;
  finalName?: string;
  finalPrice?: string;
}

/** Локальная позиция корзины (до отправки на кухню). */
export interface CartLine {
  orderItemId?: string;
  editAllowed?: boolean;
  cancelAllowed?: boolean;
  restrictionReason?: string;
  dish: Dish;
  variant?: DishVariant;
  weightGrams?: number;
  quantity: number;
  comment?: string;
  takeaway?: boolean;
  lineId?: string;
  set?: { components: CartSetComponent[] };
}
