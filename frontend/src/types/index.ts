export type Role = 'WAITER' | 'KITCHEN' | 'BAR' | 'ADMIN' | 'OWNER';

/** Направление приготовления/выдачи позиции. `none` — без отправки (официант забирает сам). */
export type PrepStation = string;

export type SectionKey =
  | 'statistics'
  | 'finance'
  | 'orders'
  | 'tables'
  | 'menu'
  | 'warehouse'
  | 'staff'
  | 'journal'
  | 'checks'
  | 'settings';

export type ActionKey =
  | 'editMenu'
  | 'refundChecks'
  | 'exportReports'
  | 'closeShift'
  | 'financeCashShifts'
  | 'createDeliveryOrders'
  | 'acceptOrderPayments'
  | 'printReceipts'
  | 'requestReceiptPrints'
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
  sections: Record<SectionKey, boolean>;
  actions: Record<ActionKey, boolean>;
  readOnlySections?: SectionKey[];
}

export interface AuthUser {
  access?: { terminal: boolean; admin: boolean; production: 'kitchen' | 'bar' | null };
  prepStation?: string | null;
  positionId?: string | null;
  positionName?: string | null;
  id: string;
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
  /** Официант, занимающий стол (активный заказ), либо null — для блокировки чужого стола. */
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
  tables: TableItem[];
  floorPlan?: FloorPlanTable[] | null;
  useFloorPlan?: boolean | null;
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
  hasModifiers?: boolean;
  allowIngredientExclusions?: boolean;
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: string; // Decimal приходит строкой
  imageUrl: string | null;
  discountType: DiscountType;
  discountValue: string;
  isAvailable: boolean;
  trackInventory?: boolean;
  stock?: number;
  minStock?: number;
  unit?: string;
  /** null/undefined = брать направление из категории. */
  prepStation?: PrepStation | null;
  /** true — это сет (состав в setComponents). */
  isSet?: boolean;
  /** Открывать визуальный выбор веса в граммах. */
  isWeighted?: boolean;
  /** Система автопересчёта: граммы/килограммы либо миллилитры/литры. */
  weightedMeasure?: 'weight' | 'volume';
  /** За сколько граммов/миллилитров указана базовая цена. */
  weightedPriceBase?: number;
  setComponents?: SetComponentDef[];
  variants: DishVariant[];
}

/** Блюдо в составе сета (из меню). */
export interface SetComponentDef {
  id: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
  /** Вариант блюда состава (например, «1 л»), если выбран. */
  dishVariantId?: string | null;
  dish: { id: string; name: string; price: string };
  dishVariant?: { id: string; name: string; price: string } | null;
}

export type SetComponentAction = 'default' | 'removed' | 'replaced';

/** Состав сета в позиции заказа (для корзины/кухни). */
export interface OrderSetComponent {
  id: string;
  action: SetComponentAction;
  /** Кухня отмечает каждое блюдо состава сета отдельно. */
  status: OrderItemStatus;
  rejectReason?: string | null;
  originalDishId: string | null;
  originalNameSnapshot: string;
  /** Снимок названия варианта блюда состава (например, «1 л»). */
  originalVariantNameSnapshot?: string | null;
  finalDishId: string | null;
  finalVariantId?: string | null;
  finalVariantNameSnapshot?: string | null;
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
  modifierSelections?: MenuModifierSelection[];
  excludedIngredientIds?: string[];
  excludedIngredientNames?: string[];
  id: string;
  /** null — блюдо удалено из меню; позиция остаётся в истории по снимкам. */
  dishId: string | null;
  dishVariantId: string | null;
  dishNameSnapshot: string;
  dishVariantNameSnapshot: string | null;
  weightGrams?: number | null;
  priceSnapshot: string;
  quantity: number;
  refundedQuantity?: number;
  discountAmount: string;
  finalPrice: string;
  status: OrderItemStatus;
  prepStation: PrepStation;
  comment: string | null;
  /** «С собой» (навынос) — кухне нужно упаковать позицию. */
  takeaway?: boolean;
  rejectReason: string | null;
  rejectionDecision?: RejectionDecision | null;
  replacementForItemId?: string | null;
  setComponents?: OrderSetComponent[];
}

export interface Order {
  taxes?: ReceiptTax[];
  stationHistoryAt?: string;
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string;
  discountAmount: string;
  serviceChargeAmount: string;
  roundOrderTotal?: boolean;
  roundingAmount?: string;
  finalAmount: string;
  refundedAmount?: string;
  paymentStatus?: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  requiresWaiterDecision: boolean;
  createdAt: string;
  table: TableItem & { hall?: { name: string } };
  waiter: { id: string; name: string } | null;
  source?: 'pos' | 'qr' | 'delivery';
  externalOrderId?: string | null;
  deliveryCustomerName?: string | null;
  deliveryCustomerPhone?: string | null;
  deliveryAddress?: string | null;
  items: OrderItem[];
  /** Разбивка по способам оплаты. Приходит в списке заказов админки. */
  payments?: { method: PaymentMethod; amount: string; source?: PaymentSource }[];
  // ККМ / фискализация (null = ККМ выключена или чек ещё не пробит).
  fiscalReceiptNumber?: string | null;
  fiscalSign?: string | null;
  fiscalQrCode?: string | null;
  fiscalError?: string | null;
  fiscalizedAt?: string | null;
}

export type MenuTaxType = 'vat' | 'turnover';

export interface MenuTax {
  id: string;
  name: string;
  rate: string | number;
  type: MenuTaxType;
}

export interface ReceiptTax extends MenuTax {
  salesAmount: string;
  amount: string;
}

export type ReceiptLanguage = 'ru' | 'ky';

export interface ReceiptPrintSettings {
  receiptLanguage: ReceiptLanguage;
  receiptPrintCafeName: boolean;
  receiptPrintAddress: boolean;
  receiptPrintPhone: boolean;
}

export interface Receipt extends Partial<ReceiptPrintSettings> {
  taxes?: ReceiptTax[];
  receiptLogoData?: string | null;
  cafeName: string;
  address?: string;
  phone?: string;
  phone2?: string;
  instagram?: string | null;
  website?: string | null;
  orderNumber: string;
  tableNumber: number;
  source?: Order['source'];
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
  roundingAmount?: string;
  finalAmount: string;
  paymentMethod: PaymentMethod | null;
  /** Разбивка по способам оплаты. */
  payments?: { method: PaymentMethod; amount: string; source?: PaymentSource }[];
  thanks: string;
}

export type ReceiptPrintStatus = 'pending' | 'approved' | 'rejected' | 'printed';

/** Тип печати: обычный (финальный) чек или счёт. */
export type ReceiptPrintType = 'receipt' | 'preliminary';

/** Запрос официанта на печать чека (подтверждается администратором). */
export interface ReceiptPrintRequest {
  id: string;
  source?: 'request' | 'order';
  priority?: boolean;
  orderId: string;
  orderNumber: string;
  tableNumber: number;
  orderSource?: Order['source'];
  type: ReceiptPrintType;
  waiterId: string;
  waiterName: string;
  amount: string;
  status: ReceiptPrintStatus | null;
  createdAt: string;
  decidedAt?: string | null;
  voice?: { text?: string | null } | null;
}

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

/** Локальная позиция корзины (до отправки на кухню). */
/** Компонент сета в корзине (с применённым изменением). */
export interface CartSetComponent {
  componentId: string;
  originalDishId: string;
  /** Вариант оригинального блюда состава (например, «1 л»), если задан. */
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

export interface CartLine {
  modifierSelections?: MenuModifierSelection[];
  excludedIngredientIds?: string[];
  excludedIngredientNames?: string[];
  orderItemId?: string;
  editAllowed?: boolean;
  cancelAllowed?: boolean;
  restrictionReason?: string;
  dish: Dish;
  variant?: DishVariant;
  /** Выбранный вес весового блюда; цена линии остаётся ценой блюда. */
  weightGrams?: number;
  quantity: number;
  comment?: string;
  /** «С собой» (навынос) для этой позиции. */
  takeaway?: boolean;
  /** Для сетов: уникальный id линии (сеты не сливаются) и изменённый состав. */
  lineId?: string;
  set?: { components: CartSetComponent[] };
}

export type NotificationType = 'info' | 'success' | 'error';

export interface AppNotification {
  id: string;
  message: string;
  type?: NotificationType;
  orderId?: string;
  orderNumber?: string;
  at: string;
  /** Сколько мс держать тост на экране (по умолчанию — по типу). */
  durationMs?: number;
}

export interface MenuModifierSelection { optionId: string; quantity: number; name: string; price: string | number; }
