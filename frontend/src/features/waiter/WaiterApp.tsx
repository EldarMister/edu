import { ModifierPicker } from './ModifierPicker';
import type { CartModifiers } from './cart';
import { usePublicSettings } from '@/features/settings/api';
import { waiterItemPermission, waiterOrderPermission } from '@/lib/order-permissions';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Order, CartLine, DishVariant, ReceiptPrintType, WaiterShift } from '@/types';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { isAxiosError } from 'axios';
import { clientId } from '@/lib/id';
import { displayOrderNumber, orderPlaceLabel, tableLabel } from '@/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useT } from '@/lib/i18n';
import { useWaiterPushNotifications } from '@/lib/push';
import { useNotifications } from '@/store/notifications';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { FullScreenLoader, Spinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { ReceiptPrintsPage } from '@/features/admin/pages/ReceiptPrintsPage';
import { useOrderReceiptPrinter } from './useOrderReceiptPrinter';
import { NumberTicker } from '@/components/NumberTicker';
import { useCart, cartLineKey, cartLineKeyFromParts, cartLineName, cartTotals } from './cart';
import { useWaiterRealtime } from './useWaiterRealtime';
import {
  useHalls,
  useCategories,
  useDishes,
  useActiveOrders,
  useCurrentShift,
  useCreateOrder,
  useAddItems,
  useEditOrder,
  usePickedUp,
  useServed,
  useToPayment,
  useResolvePartialRejection,
  useClaimQrOrder,
  useRemoveRejectedItem,
  useCancelReadyItem,
  useReplaceRejectedItem,
  useCancelOrder,
  useCallAdministrator,
  useStartShift,
  useEndShift,
  useCloseTable,
  useMoveTable,
  useTransferTable,
  useAvailableWaiters,
  useCreateReceiptPrintRequest,
  fetchReceipt,
  type AvailableWaiter,
} from './api';
import { EditOrderFulfillment, orderType, orderTypeLabel, OrderTypeSelect, type TerminalOrderType } from './OrderFulfillmentFields';
import { useReceiptPrint } from './receiptPrint';
import { TablesGrid } from './TablesGrid';
import { DishMenu } from './DishMenu';
import { CartPanel } from './CartPanel';
import { CartSheet } from './CartSheet';
import { cartStations } from '@/lib/prep-station';
import { OrderPanel } from './OrderPanel';
import { OrdersList } from './OrdersList';
import { OrdersPage } from '@/features/admin/pages/OrdersPage';
import { WaiterProfile } from './WaiterProfile';
import { WaiterCabinet } from './WaiterCabinet';
import { WaiterOrderArchive } from './WaiterOrderArchive';
import { TerminalFunctions, TerminalFunctionsButton } from './TerminalFunctions';
import { useRefundUpdates } from '@/features/refunds/api';
import { useItemCancellationUpdates, useRequestItemCancellation } from '@/features/requests/item-cancellations';
import { CashShiftBanner, type CashShiftEditor } from '@/features/settings/CashShiftControls';
import { WorkspaceLinks } from '@/components/WorkspaceLinks';
import { useRadioVisibility } from '@/features/ptt/radioVisibility';
import { PaymentModal } from './PaymentModal';
import { SplitOrderModal } from './SplitOrderModal';
import { canSplitAmount, canSplitOrder, type AmountSplitMode, type SplitMode } from './splitBillModel';
import { ReceiptPrintSheet } from './ReceiptPrintSheet';
import { ShiftSummaryModal } from './ShiftSummaryModal';
import { ShiftRequiredScreen } from './ShiftRequiredScreen';
import { useShiftStartRequest } from '@/features/settings/work-shift-request';
import { CancelOrderModal } from './CancelOrderModal';
import { InsufficientPermissionsModal } from './InsufficientPermissionsModal';
import {
  TableActionsMenu,
  TableSelectButton,
  TableSelectModal,
  CloseTableModal,
  MoveTableModal,
  TransferTableModal,
} from './TableActions';
import './terminal-dialogs.css';

type Tab = 'tables' | 'menu' | 'cart' | 'orders' | 'profile';
type DesktopTab = 'tables' | 'orders' | 'profile';

/** Сколько секунд показывается блок отмены действия, прежде чем отмена заказа уйдёт на сервер. */
const CANCEL_UNDO_SECONDS = 6;
type PendingCancel = { order: Order; reason: string; deadline: number };
type ReplacementTarget = { order: Order; item: Order['items'][number] };
const checkFamily = (order: Order) => order.splitFromOrderId ?? order.id;
const WIDE_TERMINAL = '(min-width: 768px)';

function subscribeToTerminalSize(onChange: () => void) {
  const media = window.matchMedia(WIDE_TERMINAL);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function isWideTerminal() {
  return window.matchMedia(WIDE_TERMINAL).matches;
}

export function WaiterApp() {
  const wideLayout = useSyncExternalStore(subscribeToTerminalSize, isWideTerminal);
  useWaiterRealtime();
  useRefundUpdates('terminal');
  useItemCancellationUpdates('terminal');
  const settings = usePublicSettings();
  const user = useAuth((s) => s.user);
  const push = useNotifications((s) => s.push);
  const t = useT();
  const { canAction, canOwnerOperation } = usePermissions();
  const canCreateDelivery = canAction('createDeliveryOrders');
  const canTakePayment = canAction('acceptOrderPayments');
  const canPrintReceipts = canAction('printReceipts');
  const canHandlePrintQueue = canPrintReceipts && canOwnerOperation('printRequests');
  const canRequestPrint = canAction('requestReceiptPrints');
  const pushNotifications = useWaiterPushNotifications(!!user);

  const hallsQ = useHalls();
  const categoriesQ = useCategories();
  const dishesQ = useDishes();
  const ordersQ = useActiveOrders();
  const trackShift = user?.permissions?.workShiftRequired !== false;
  const currentShiftQ = useCurrentShift(trackShift);
  const shiftRequest = useShiftStartRequest(trackShift && currentShiftQ.isSuccess && !currentShiftQ.data);

  const cart = useCart();
  const create = useCreateOrder();
  const addItems = useAddItems();
  const editOrder = useEditOrder();
  const pickedUp = usePickedUp();
  const served = useServed();
  const toPayment = useToPayment();
  const resolvePartialRejection = useResolvePartialRejection();
  const claimQrOrder = useClaimQrOrder();
  const removeRejectedItem = useRemoveRejectedItem();
  const cancelReadyItem = useCancelReadyItem();
  const replaceRejectedItem = useReplaceRejectedItem();
  const cancelOrder = useCancelOrder();
  const administratorCall = useCallAdministrator();
  const startShift = useStartShift();
  const endShift = useEndShift();
  const closeTable = useCloseTable();
  const moveTable = useMoveTable();
  const transferTable = useTransferTable();
  const createPrintRequest = useCreateReceiptPrintRequest();
  const beginPrint = useReceiptPrint((s) => s.begin);
  const printOrderReceipt = useOrderReceiptPrinter();
  const [printQueueOpen, setPrintQueueOpen] = useState(false);
  const [functionsOpen, setFunctionsOpen] = useState(false);
  const [cashShiftEditor, setCashShiftEditor] = useState<CashShiftEditor | null>(null);
  const [printingReceipt, setPrintingReceipt] = useState(false);

  const [tab, setTab] = useState<Tab>('tables');
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [paymentSplitMode, setPaymentSplitMode] = useState<AmountSplitMode>();
  const [splitOrder, setSplitOrder] = useState<Order | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [administratorCallTarget, setAdministratorCallTarget] = useState<{ order: Order; item?: Order['items'][number] } | null>(null);
  const itemCancellation = useRequestItemCancellation();
  const administratorPromptAudio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = administratorPromptAudio.current;
    return () => audio?.pause();
  }, []);
  const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [orderArchiveOpen, setOrderArchiveOpen] = useState(false);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<WaiterShift | null>(null);
  const [tableModal, setTableModal] = useState<'close' | 'move' | 'transfer' | null>(null);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [modifierLine, setModifierLine] = useState<CartLine | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<ReplacementTarget | null>(null);
  const [idemKey, setIdemKey] = useState(() => clientId());
  const [deliveryIdemKey, setDeliveryIdemKey] = useState(() => clientId());
  const returnTable = useRef<string | null>(null);
  const [choosingDineInTable, setChoosingDineInTable] = useState(false);
  const [addItemsIdemKey, setAddItemsIdemKey] = useState(() => clientId());
  // Пока идёт запуск смены, оверлей «Смена не начата» удерживается до конца анимации.
  const [shiftBusy, setShiftBusy] = useState(false);

  const availableWaitersQ = useAvailableWaiters(tableModal === 'transfer');

  const halls = hallsQ.data ?? [];
  const orders = ordersQ.data ?? [];
  const activeShift = currentShiftQ.data ?? null;
  // Смена не начата → показываем экран-оверлей «Смена не начата» поверх контента вкладок.
  // Профиль остаётся доступным (там можно начать смену, посмотреть свои данные, выйти).
  const shiftActive = !!activeShift && activeShift.status === 'active';
  const canWork = !trackShift || shiftActive;
  const showShiftGate = trackShift && (!shiftActive || shiftBusy) && tab !== 'profile';

  // Самый свежий активный заказ по каждому столу (бэкенд отдаёт по убыванию даты).
  const ordersByTable = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of orders) if (orderType(o.source) === 'dine_in' && !m.has(o.table.id)) m.set(o.table.id, o);
    return m;
  }, [orders]);

  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of cart.lines) {
      map[l.dish.id] = (map[l.dish.id] ?? 0) + l.quantity;
      if (l.variant) {
        map[l.variant.id] = (map[l.variant.id] ?? 0) + l.quantity;
      }
    }
    return map;
  }, [cart.lines]);

  // Сколько разных строк корзины у блюда (для блюд с размерами: одна строка —
  // можно показать «минус», несколько размеров — убираем их в корзине).
  const cartLineCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of cart.lines) map[l.dish.id] = (map[l.dish.id] ?? 0) + 1;
    return map;
  }, [cart.lines]);

  // Уменьшить количество с карточки меню: если у блюда ровно одна строка
  // в корзине (обычное блюдо или один выбранный размер) — уменьшаем её.
  const decDishFromMenu = (dishId: string) => {
    const lines = cart.lines.filter((l) => l.dish.id === dishId);
    if (lines.length === 1) cart.dec(cartLineKey(lines[0]));
  };

  const selectedTableId = cart.target?.kind === 'table' ? cart.target.tableId : null;
  const deliveryCart = cart.target?.kind === 'delivery' ? cart.target : null;
  const newDelivery = !!deliveryCart && !deliveryCart.orderId;
  const selectedTable = halls.flatMap((h) => h.tables).find((t) => t.id === selectedTableId) ?? null;
  const selectedHallName = selectedTable
    ? halls.find((h) => h.id === selectedTable.hallId)?.name
    : undefined;
  const selectedCheck = selectedCheckId ? orders.find((order) => order.id === selectedCheckId && order.table.id === selectedTableId) : undefined;
  const activeOrder = selectedTableId ? selectedCheck ?? ordersByTable.get(selectedTableId)
    : deliveryCart?.orderId ? orders.find((order) => order.id === deliveryCart.orderId) : undefined;
  const canUseMenu = !!(selectedTable || (newDelivery ? canCreateDelivery : deliveryCart && activeOrder));
  const editing = !!editingOrderId && !!activeOrder && activeOrder.id === editingOrderId;
  const roundCart = activeOrder ? editing && activeOrder.roundOrderTotal : settings.data?.roundOrderTotal;
  const viewingOrder = viewingOrderId ? orders.find((o) => o.id === viewingOrderId) : undefined;
  const displayedOrder = viewingOrder ?? activeOrder;
  const relatedChecks = !displayedOrder || orderType(displayedOrder.source) !== 'dine_in' ? []
    : orders.filter((order) => checkFamily(order) === checkFamily(displayedOrder));
  const splitModes: SplitMode[] = [];
  if (displayedOrder && canTakePayment && canWork) {
    if (canSplitOrder(displayedOrder)) splitModes.push('items');
    if (canSplitAmount(displayedOrder)) splitModes.push('amount', 'equal');
  }
  const showCart = !viewingOrder && (cart.lines.length > 0 || !activeOrder);
  const activeNavTab: Tab = viewingOrder && tab === 'cart' ? 'orders' : tab;
  // Направления позиций корзины. Только «Без отправки» → готовить нечего,
  // кнопка вместо «Отправить на кухню» становится «Добавить в заказ».
  const cartStationInfo = cartStations(cart.lines, categoriesQ.data ?? []);
  const cartOnlyNone = cart.lines.length > 0 && !cartStationInfo.hasPrep;
  // Подпись отправки нового заказа: есть кухня (в т.ч. смешанно) → «на кухню»,
  // только бар → «в бар», только без отправки → «Добавить в заказ».
  const cartSendLabel = newDelivery
    ? t('Отправить заказ')
    : cartOnlyNone
    ? t('Добавить в заказ')
    : cartStationInfo.kitchen
      ? t('Отправить на кухню')
      : t('Отправить в бар');
  const cartSubmitLabel = editing
    ? t('Сохранить изменения')
    : activeOrder
      ? t('Добавить к заказу')
      : cartSendLabel;
  const ordersAttentionCount = orders.filter((o) =>
    o.requiresWaiterDecision || ['ready', 'rejected'].includes(o.status),
  ).length;
  const showPushBanner = ['default', 'error'].includes(pushNotifications.status);

  const actionPending =
    pickedUp.isPending ||
    served.isPending ||
    toPayment.isPending ||
    resolvePartialRejection.isPending ||
    claimQrOrder.isPending ||
    removeRejectedItem.isPending ||
    cancelReadyItem.isPending ||
    replaceRejectedItem.isPending ||
    cancelOrder.isPending;
  const shiftPending = startShift.isPending || endShift.isPending;

  // Пока ждём окончания таймера отмены — тикаем раз в секунду (для обратного отсчёта)
  // и по истечении дедлайна фиксируем отмену на сервере. Хук должен идти ДО раннего
  // return ниже, иначе порядок хуков нарушится (белый экран).
  useEffect(() => {
    if (!pendingCancel) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const commit = setTimeout(() => {
      commitCancel(pendingCancel);
      setPendingCancel(null);
    }, Math.max(0, pendingCancel.deadline - Date.now()));
    return () => {
      clearInterval(tick);
      clearTimeout(commit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCancel]);

  useEffect(() => {
    const hasMenuCartBar = tab === 'menu' && !replacementTarget && !showShiftGate;
    document.documentElement.style.setProperty('--edu-ptt-floating-bottom', hasMenuCartBar ? '132px' : '76px');
    return () => {
      document.documentElement.style.removeProperty('--edu-ptt-floating-bottom');
    };
  }, [replacementTarget, showShiftGate, tab]);

  // Кнопка рации у официанта — только на «Столах», списке «Заказов» и «Профиле».
  // На подробном заказе, в меню/корзине, личном кабинете и экране «Смена не начата» её прячем.
  const radioButtonVisible =
    !showShiftGate &&
    (activeNavTab === 'tables' ||
      (activeNavTab === 'orders' && !viewingOrder) ||
      (activeNavTab === 'profile' && !cabinetOpen));
  useEffect(() => {
    useRadioVisibility.getState().setWaiterButtonVisible(radioButtonVisible);
    return () => useRadioVisibility.getState().setWaiterButtonVisible(true);
  }, [radioButtonVisible]);

  if (hallsQ.isLoading || categoriesQ.isLoading || dishesQ.isLoading || currentShiftQ.isLoading) {
    return <FullScreenLoader />;
  }

  // Стол занят другим официантом → нельзя заходить. Возвращает имя владельца или null.
  function blockedByOther(tableId: string): string | null {
    const table = halls.flatMap((h) => h.tables).find((tbl) => tbl.id === tableId);
    const owner = table?.occupiedBy;
    return owner && owner.id !== user?.id ? owner.name : null;
  }

  function selectTable(tableId: string) {
    const otherWaiter = blockedByOther(tableId);
    if (otherWaiter) {
      push({
        message: `Этот стол занят другим официантом: ${otherWaiter}`,
        type: 'error',
        at: new Date().toISOString(),
      });
      return;
    }
    setViewingOrderId(null);
    setEditingOrderId(null);
    cart.selectTable(tableId);
    setTab(ordersByTable.has(tableId) ? 'cart' : 'menu');
  }

  // Смена стола прямо на экране меню (кнопка рядом с поиском).
  function pickMenuTable(tableId: string) {
    if (choosingDineInTable) {
      if (returnDraftToTable(tableId)) {
        setChoosingDineInTable(false);
        setTablePickerOpen(false);
      }
      return;
    }
    setTablePickerOpen(false);
    if (tableId === selectedTableId) return;
    const otherWaiter = blockedByOther(tableId);
    if (otherWaiter) {
      push({
        message: `Этот стол занят другим официантом: ${otherWaiter}`,
        type: 'error',
        at: new Date().toISOString(),
      });
      return;
    }
    if (cart.lines.length === 0) {
      cart.selectTable(tableId);
    } else {
      // В корзине уже есть блюда — спрашиваем про перенос на другой стол.
      setPendingTableId(tableId);
    }
  }

  function confirmMoveCart() {
    if (pendingTableId) cart.moveDraftTo(pendingTableId);
    setPendingTableId(null);
  }

  function startDelivery() {
    if (!canCreateDelivery || !canWork) return;
    setViewingOrderId(null);
    setEditingOrderId(null);
    setReplacementTarget(null);
    cart.select({ kind: 'delivery' });
    setTab('menu');
  }

  function returnDraftToTable(tableId: string) {
    if (!ordersByTable.has(tableId) && !blockedByOther(tableId) && cart.moveNewOrderDraft({ kind: 'table', tableId })) {
      setViewingOrderId(null);
      setSelectedCheckId(null);
      setTab('menu');
      return true;
    }
    push({ message: t('Выберите свободный стол без другого черновика'), type: 'error', at: new Date().toISOString() });
    return false;
  }

  function switchOrderType(next: TerminalOrderType) {
    if (!canCreateDelivery || !canWork || editing || activeOrder || create.isPending) return;
    if (next === 'dine_in') {
      if (!deliveryCart) return;
      const previous = returnTable.current;
      if (previous && halls.some((hall) => hall.tables.some(({ id }) => id === previous)) && returnDraftToTable(previous)) return;
      setChoosingDineInTable(true);
      setTablePickerOpen(true);
      return;
    }
    if (!deliveryCart && !cart.moveNewOrderDraft({ kind: 'delivery' })) {
      push({ message: t('Сначала оформите текущий заказ вне зала'), type: 'error', at: new Date().toISOString() });
      return;
    }
    if (selectedTableId) returnTable.current = selectedTableId;
    setViewingOrderId(null);
    setTab('menu');
  }

  function selectOrderCart(order: Order) {
    setSelectedCheckId(order.id);
    if (orderType(order.source) !== 'dine_in') cart.select({ kind: 'delivery', orderId: order.id });
    else cart.selectTable(order.table.id);
  }

  // --- Редактирование заказа (Фаза 1: только пока кухня не приняла заказ) ---
  function startEditOrder(order: Order) {
    const permission = waiterOrderPermission(order, 'edit', settings.data?.waiterOrderPermissions);
    if (!permission.allowed) { push({ message: permission.reason, type: 'error', at: new Date().toISOString() }); return; }
    if (order.items.some((it) => !['cancelled', 'rejected'].includes(it.status) && !dishesQ.data?.some((dish) => dish.id === it.dishId))) {
      push({ message: 'В заказе есть удалённое из меню блюдо. Используйте отмену отдельной позиции или обратитесь к администратору.', type: 'error', at: new Date().toISOString() }); return;
    }
    setViewingOrderId(null);
    selectOrderCart(order);
    const dishById = new Map((dishesQ.data ?? []).map((d) => [d.id, d]));
    const lines = order.items
      .filter((it) => it.status !== 'rejected' && it.status !== 'cancelled')
      .map((it) => {
        const editPermission = waiterItemPermission(order, it, 'edit', settings.data?.waiterOrderPermissions);
        const cancelPermission = waiterItemPermission(order, it, 'cancel', settings.data?.waiterOrderPermissions);
        const origin = { orderItemId: it.id, lineId: `edit-${it.id}`, editAllowed: editPermission.allowed, cancelAllowed: cancelPermission.allowed,
          restrictionReason: !editPermission.allowed ? editPermission.reason : !cancelPermission.allowed ? cancelPermission.reason : undefined };
        const dish = it.dishId ? dishById.get(it.dishId) : undefined;
        if (!dish) return null;
        // Сет — восстанавливаем линию с изменённым составом.
        if (dish.isSet && it.setComponents?.length) {
          // Ключ учитывает вариант: одно блюдо с разными вариантами — разные строки.
          const defKey = (dishId: string, variantName?: string | null) => `${dishId}|${variantName ?? ''}`;
          const defs = new Map(
            (dish.setComponents ?? []).map((sc) => [defKey(sc.dish.id, sc.dishVariant?.name), sc]),
          );
          const components = it.setComponents.map((sc) => {
            const def = defs.get(defKey(sc.originalDishId ?? '', sc.originalVariantNameSnapshot));
            const finalDish = sc.finalDishId ? dishById.get(sc.finalDishId) : undefined;
            const finalVariant = sc.finalVariantId
              ? finalDish?.variants.find((candidate) => candidate.id === sc.finalVariantId)
              : undefined;
            return {
              componentId: def?.id ?? sc.id,
              originalDishId: sc.originalDishId ?? '',
              originalVariantId: def?.dishVariant?.id,
              originalName: sc.originalVariantNameSnapshot
                ? `${sc.originalNameSnapshot} ${sc.originalVariantNameSnapshot}`
                : sc.originalNameSnapshot,
              originalPrice: def?.dishVariant?.price ?? def?.dish.price ?? '0',
              quantity: sc.quantity,
              removable: def?.removable ?? true,
              replaceable: def?.replaceable ?? true,
              action: sc.action,
              finalDishId: sc.finalDishId ?? undefined,
              finalVariantId: sc.finalVariantId ?? undefined,
              finalName: sc.finalNameSnapshot
                ? [sc.finalNameSnapshot, sc.finalVariantNameSnapshot].filter(Boolean).join(' ')
                : undefined,
              finalPrice: finalVariant?.price ?? finalDish?.price,
            };
          });
          return {
            ...origin,
            dish,
            comment: it.comment ?? undefined,
            modifierSelections: it.modifierSelections, excludedIngredientIds: it.excludedIngredientIds, excludedIngredientNames: it.excludedIngredientNames,
            quantity: it.quantity,
            takeaway: it.takeaway ?? undefined,
            lineId: `set-edit-${it.id}`,
            set: { components },
          } as CartLine;
        }
        const variant = it.dishVariantId
          ? dish.variants.find((candidate) => candidate.id === it.dishVariantId)
          : undefined;
        return {
          ...origin,
          dish,
          variant,
          weightGrams: it.weightGrams ?? undefined,
          quantity: it.quantity,
          comment: it.comment ?? undefined,
            modifierSelections: it.modifierSelections, excludedIngredientIds: it.excludedIngredientIds, excludedIngredientNames: it.excludedIngredientNames,
          takeaway: it.takeaway ?? undefined,
        } as CartLine;
      })
      .filter((l): l is CartLine => l !== null);
    cart.replaceLines(lines, order.comment ?? '');
    setEditingOrderId(order.id);
    setTab('menu');
    push({
      message: `${t('Редактирование')} ${displayOrderNumber(order.orderNumber)}`,
      type: 'info',
      at: new Date().toISOString(),
    });
  }

  async function saveEditOrder() {
    if (!editingOrderId) return;
    try {
      await editOrder.mutateAsync({
        orderId: editingOrderId,
        reason: 'Изменение состава заказа',
        comment: cart.commentOpen ? cart.comment : '',
        lines: cart.lines,
      });
      cart.clear();
      setEditingOrderId(null);
      push({ message: t('Изменения сохранены'), type: 'success', at: new Date().toISOString() });
      setTab('orders');
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  function cancelEditing() {
    cart.clear();
    setEditingOrderId(null);
    setTab('orders');
  }

  // Отмена заказа происходит не сразу: показываем блок отмены действия с таймером,
  // и официант может вернуть заказ, пока отмена не ушла на сервер.
  function confirmCancelOrder(reason: string) {
    if (!cancelTarget) return;
    if (pendingCancel) commitCancel(pendingCancel); // незавершённую предыдущую — фиксируем сразу
    setPendingCancel({ order: cancelTarget, reason, deadline: Date.now() + CANCEL_UNDO_SECONDS * 1000 });
    setCancelTarget(null);
  }

  function requestOrderCancellation(order: Order) {
    const permission = waiterOrderPermission(order, 'cancel', settings.data?.waiterOrderPermissions);
    if (!canOwnerOperation('cancelOrders') || (user?.role !== 'OWNER' && !permission.allowed)) {
      openAdministratorPrompt(order);
      return;
    }
    setCancelTarget(order);
  }

  function openAdministratorPrompt(order: Order, item?: Order['items'][number]) {
    setCancelTarget(null);
    itemCancellation.reset();
    setAdministratorCallTarget({ order, item });
    const audio = administratorPromptAudio.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }

  function closeAdministratorPrompt() {
    administratorPromptAudio.current?.pause();
    setAdministratorCallTarget(null);
  }

  async function callAdministrator() {
    if (!administratorCallTarget) return;
    try {
      await administratorCall.mutateAsync(administratorCallTarget.order.id);
      closeAdministratorPrompt();
      push({
        message: t('Администратор вызван'),
        type: 'success',
        at: new Date().toISOString(),
      });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function requestItemCancellation(reason: string) {
    const target = administratorCallTarget;
    if (!target?.item) return;
    try {
      await itemCancellation.mutateAsync({ orderId: target.order.id, itemId: target.item.id, reason });
      closeAdministratorPrompt();
      push({ message: t('Заявка на отмену отправлена'), type: 'success', at: new Date().toISOString() });
    } catch {
      // Ошибка остаётся в форме вместе с введённой причиной.
    }
  }

  function commitCancel(p: PendingCancel) {
    cancelOrder
      .mutateAsync({ orderId: p.order.id, reason: p.reason })
      .then(() => push({ message: t('Заказ отменён'), type: 'success', at: new Date().toISOString() }))
      .catch((err) => showCancellationError(p.order, err));
  }

  function showCancellationError(order: Order, error: unknown) {
    if (isAxiosError(error) && error.response?.status === 403) {
      openAdministratorPrompt(order);
      return;
    }
    push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
  }

  function undoCancel() {
    setPendingCancel(null);
    push({ message: t('Отмена заказа отменена'), type: 'info', at: new Date().toISOString() });
  }

  function changeTab(next: Tab) {
    setViewingOrderId(null);
    setCabinetOpen(false);
    setTab(next);
  }

  function openExistingOrder(order: Order) {
    setViewingOrderId(order.id);
    selectOrderCart(order);
    setTab(order.requiresWaiterDecision ? 'orders' : 'cart');
  }

  async function claimQr(order: Order) {
    if (!canWork) {
      push({ message: t('Сначала начните смену в профиле.'), type: 'error', at: new Date().toISOString() });
      return;
    }
    try {
      const updated = await claimQrOrder.mutateAsync(order.id);
      cart.selectTable(updated.table.id);
      setViewingOrderId(updated.id);
      setTab('orders');
      push({
        message: `${t('QR-заказ взят')} · ${tableLabel(updated.table, t('Стол'))}`,
        type: 'success',
        at: new Date().toISOString(),
      });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  function orderItemName(item: Order['items'][number]) {
    return item.dishVariantNameSnapshot
      ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
      : item.dishNameSnapshot;
  }

  async function replaceRejectedWithLine(line: CartLine) {
    if (!replacementTarget) return;
    try {
      const updated = await replaceRejectedItem.mutateAsync({
        orderId: replacementTarget.order.id,
        itemId: replacementTarget.item.id,
        line,
      });
      setReplacementTarget(null);
      setViewingOrderId(updated.id);
      selectOrderCart(updated);
      setTab('orders');
      push({
        message: `${orderItemName(replacementTarget.item)} заменено`,
        type: 'success',
        at: new Date().toISOString(),
      });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  function addDishToCart(dish: Parameters<typeof cart.add>[0], variant?: DishVariant, weightGrams?: number, modifiers?: CartModifiers) {
    if ((dish.hasModifiers || dish.allowIngredientExclusions) && !modifiers) { setModifierLine({ dish, variant, weightGrams, quantity: 1 }); return; }

    if (replacementTarget) {
      void replaceRejectedWithLine({ dish, variant, weightGrams, quantity: 1, ...modifiers });
      return;
    }

    const key = cartLineKeyFromParts(dish.id, variant?.id, weightGrams, modifiers);
    const nextQuantity = (cart.lines.find((line) => cartLineKeyFromParts(line.dish.id, line.variant?.id, line.weightGrams, line) === key)?.quantity ?? 0) + 1;
    cart.add(dish, variant, weightGrams, modifiers);
    const name = cartLineName({ dish, variant, weightGrams, quantity: 1 });
    push({ message: `${name} ×${nextQuantity} добавлено`, at: new Date().toISOString(), durationMs: 1800 });
  }

  function addSetToCart(set: Parameters<typeof cart.addSet>[0], components: Parameters<typeof cart.addSet>[1], modifiers?: CartModifiers) {
    if ((set.hasModifiers || set.allowIngredientExclusions) && !modifiers) { setModifierLine({ dish: set, quantity: 1, set: { components } }); return; }
    if (replacementTarget) {
      void replaceRejectedWithLine({
        dish: set,
        quantity: 1,
        lineId: `set-replacement-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        set: { components }, ...modifiers,
      });
      return;
    }
    cart.addSet(set, components, modifiers);
    push({ message: `${set.name} добавлен`, at: new Date().toISOString(), durationMs: 1800 });
  }

  async function goToPayment(order: Order, splitMode?: AmountSplitMode) {
    if (!canTakePayment) return;
    if (order.status === 'waiting_payment') {
      setPaymentSplitMode(splitMode);
      setPaymentOrder(order);
      return;
    }

    try {
      const updated = await toPayment.mutateAsync(order.id);
      setPaymentSplitMode(splitMode);
      setPaymentOrder(updated);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  function showSplitOrder(order: Order) {
    setPaymentOrder(null);
    setSplitOrder(order);
    setViewingOrderId(order.id);
  }

  function showNewCheck(source: Order, next: Order) {
    setSplitOrder(null);
    selectOrderCart(source);
    setViewingOrderId(source.id);
    setTab('cart');
    push({ message: `${t('Создан чек')} ${displayOrderNumber(next.orderNumber)}`, type: 'success', at: new Date().toISOString() });
  }

  function finishPayment(order: Order) {
    setPaymentOrder(null);
    const remaining = orders.find((candidate) => candidate.id !== order.id && checkFamily(candidate) === checkFamily(order));
    if (remaining) selectOrderCart(remaining);
    setViewingOrderId(remaining?.id ?? null);
    setTab(remaining ? 'cart' : 'tables');
  }

  // Для сотрудников без прямой печати отправляем заявку и показываем её статус.
  async function requestOrderReceipt(order: Order, type: ReceiptPrintType) {
    if (canPrintReceipts) {
      const printWindow = window.open('', '_blank', 'width=380,height=640');
      if (!printWindow) {
        push({ message: t('Разрешите всплывающие окна и повторите печать.'), type: 'error', at: new Date().toISOString() });
        return;
      }
      setPrintingReceipt(true);
      try {
        await printOrderReceipt(order.id, printWindow, { preliminary: type === 'preliminary' });
      } catch (error) {
        printWindow.close();
        push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
      } finally {
        setPrintingReceipt(false);
      }
      return;
    }
    if (!canRequestPrint) return;
    try {
      const [request, receipt] = await Promise.all([
        createPrintRequest.mutateAsync({ orderId: order.id, type }),
        fetchReceipt(order.id),
      ]);
      beginPrint(request, receipt);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function continueAfterPartialRejection(order: Order) {
    try {
      await resolvePartialRejection.mutateAsync(order.id);
      push({ message: t('Заказ продолжен без отказанного блюда'), type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  function replaceRejectedFromOrder(order: Order, item: Order['items'][number]) {
    setReplacementTarget({ order, item });
    setViewingOrderId(null);
    selectOrderCart(order);
    setTab('menu');
    push({
      message: `${t('Выберите блюдо на замену')}: ${orderItemName(item)}`,
      type: 'info',
      at: new Date().toISOString(),
    });
  }

  async function removeRejectedFromOrder(order: Order, item: Order['items'][number]) {
    try {
      const updated = await removeRejectedItem.mutateAsync({ orderId: order.id, itemId: item.id });
      setViewingOrderId(updated.id);
      selectOrderCart(updated);
      setTab('orders');
      push({ message: `${orderItemName(item)} убрано из заказа`, type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function cancelReadyItemFromOrder(order: Order, item: Order['items'][number], reason: string) {
    try {
      const updated = await cancelReadyItem.mutateAsync({ orderId: order.id, itemId: item.id, reason });
      setViewingOrderId(updated.id);
      selectOrderCart(updated);
      setTab('orders');
      push({ message: `${orderItemName(item)} отменено`, type: 'success', at: new Date().toISOString() });
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403) openAdministratorPrompt(order, item);
      else showCancellationError(order, err);
    }
  }

  async function cancelAfterPartialRejection(order: Order) {
    if (!canOwnerOperation('cancelOrders') || (user?.role !== 'OWNER' && !waiterOrderPermission(order, 'cancel', settings.data?.waiterOrderPermissions).allowed)) {
      openAdministratorPrompt(order);
      return;
    }
    try {
      await cancelOrder.mutateAsync({
        orderId: order.id,
        reason: 'Клиент отменил заказ после частичного отказа кухни',
      });
      cart.clear();
      setViewingOrderId(null);
      setTab('tables');
      push({ message: t('Заказ отменён'), type: 'success', at: new Date().toISOString() });
    } catch (err) {
      showCancellationError(order, err);
    }
  }

  async function submitCart() {
    if (!canUseMenu || !cart.lines.length || create.isPending || addItems.isPending) return;
    if (!canWork) {
      push({ message: t('Сначала начните смену в профиле.'), type: 'error', at: new Date().toISOString() });
      return;
    }
    const destination = newDelivery ? { delivery: { type: 'delivery' as const } }
      : selectedTable ? { tableId: selectedTable.id } : null;
    try {
      if (activeOrder) {
        await addItems.mutateAsync({
          orderId: activeOrder.id,
          idempotencyKey: addItemsIdemKey,
          lines: cart.lines,
        });
        cart.clear();
        setAddItemsIdemKey(clientId());
        push({
          message: cartOnlyNone ? t('Позиции добавлены в заказ') : t('Заказ отправлен на кухню'),
          type: 'success',
          at: new Date().toISOString(),
        });
        setTab('cart');
      } else if (destination) {
        await create.mutateAsync({
          ...destination,
          comment: newDelivery || cart.commentOpen ? cart.comment : '',
          idempotencyKey: newDelivery ? deliveryIdemKey : idemKey,
          lines: cart.lines,
        });
        cart.clear();
        if (newDelivery) {
          cart.select(null);
          setDeliveryIdemKey(clientId());
        } else {
          setIdemKey(clientId());
        }
        push({
          message: newDelivery ? t('Заказ создан') : cartOnlyNone ? t('Заказ создан') : t('Заказ отправлен на кухню'),
          type: 'success',
          at: new Date().toISOString(),
        });
        setTab('orders');
      }
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function runAction(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  // --- Действия со столом ---
  async function doCloseTable() {
    if (!selectedTable) return;
    try {
      await closeTable.mutateAsync(selectedTable.id);
      push({ message: t('Стол успешно закрыт'), type: 'success', at: new Date().toISOString() });
      setTableModal(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function doMoveTable(targetTableId: string) {
    if (!selectedTable) return;
    try {
      const updated = await moveTable.mutateAsync({ tableId: selectedTable.id, targetTableId });
      cart.selectTable(targetTableId);
      setViewingOrderId(null);
      push({ message: `${t('Заказ перенесён на стол')} ${updated.table.name ? `«${updated.table.name}»` : `№${updated.table.number}`}`, type: 'success', at: new Date().toISOString() });
      setTableModal(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function doTransferTable(waiter: AvailableWaiter) {
    if (!selectedTable) return;
    try {
      await transferTable.mutateAsync({ tableId: selectedTable.id, waiterId: waiter.id });
      push({ message: `${t('Стол передан официанту')} ${waiter.name}`, type: 'success', at: new Date().toISOString() });
      setTableModal(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  // --- Панели ---
  const tablesPanel = (
    <Panel
      title={t('Выбор стола')}
      action={
        <TableActionsMenu
          disabled={!selectedTable}
          onCloseTable={() => setTableModal('close')}
          onMove={() => setTableModal('move')}
          onTransfer={() => setTableModal('transfer')}
        />
      }
    >
      <TablesGrid halls={halls} selectedTableId={selectedTableId} onSelect={selectTable} useMap={settings.data?.useFloorPlan}
        trailingAction={canCreateDelivery && (
          <button type="button" className="shrink-0 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-background disabled:opacity-50 md:hidden"
            disabled={!canWork || create.isPending} onClick={startDelivery}>
            {t('Доставка')}
          </button>
        )} />
    </Panel>
  );

  const currentOrderType = deliveryCart ? (activeOrder ? orderType(activeOrder.source) : 'delivery') : 'dine_in';
  const typeControl = canCreateDelivery && !activeOrder && !editing
    ? <OrderTypeSelect value={newDelivery ? 'delivery' : 'dine_in'} disabled={!canWork || create.isPending} onChange={switchOrderType} />
    : undefined;
  const deliveryChip = deliveryCart && (
    <span className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{t(orderTypeLabel(currentOrderType))}</span>
  );

  const menuPanel = (
    <Panel title={t('Меню')} action={deliveryChip}>
      <DishMenu
        categories={categoriesQ.data ?? []}
        dishes={dishesQ.data ?? []}
        quantities={cartQuantities}
        lineCounts={cartLineCounts}
        onAdd={addDishToCart}
        onAddSet={addSetToCart}
        onDec={(d) => decDishFromMenu(d.id)}
        disabled={!canUseMenu}
      />
    </Panel>
  );

  // Мобильный экран меню: без заголовка, выбор стола в строке поиска.
  const mobileMenuNode = (
    <section className="flex h-full flex-col bg-white px-2 py-2">
      <DishMenu
        categories={categoriesQ.data ?? []}
        dishes={dishesQ.data ?? []}
        quantities={cartQuantities}
        lineCounts={cartLineCounts}
        onAdd={addDishToCart}
        onAddSet={addSetToCart}
        onDec={(d) => decDishFromMenu(d.id)}
        disabled={!canUseMenu}
        tableSlot={
          selectedTable ? (
            <TableSelectButton table={selectedTable} hallName={selectedHallName} onClick={() => setTablePickerOpen(true)} />
          ) : deliveryChip
        }
      />
    </section>
  );

  const rightPanel = (
    <Panel title={null}>
      {!canUseMenu && !displayedOrder && !canCreateDelivery ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
          {t('Выберите стол, чтобы открыть заказ')}
        </div>
      ) : displayedOrder && !showCart ? (
        <OrderPanel
          key={displayedOrder.id}
          order={displayedOrder}
          submitting={actionPending}
          preliminaryPending={createPrintRequest.isPending || printingReceipt}
          claimPending={claimQrOrder.isPending}
          onClaimQr={() => claimQr(displayedOrder)}
          onPickedUp={() => runAction(() => pickedUp.mutateAsync(displayedOrder.id))}
          onServed={() => runAction(() => served.mutateAsync(displayedOrder.id))}
          onToPayment={canTakePayment ? () => goToPayment(displayedOrder) : undefined}
          onPreliminaryReceipt={canPrintReceipts || canRequestPrint ? () => requestOrderReceipt(displayedOrder, 'preliminary') : undefined}
          onContinueAfterRejection={() => continueAfterPartialRejection(displayedOrder)}
          onReplaceRejectedItem={(item) => replaceRejectedFromOrder(displayedOrder, item)}
          onRemoveRejectedItem={(item) => removeRejectedFromOrder(displayedOrder, item)}
          onCancelReadyItem={(item, reason) => cancelReadyItemFromOrder(displayedOrder, item, reason)}
          cancellationDeniedOpen={!!administratorCallTarget}
          onInsufficientPermissions={(item) => openAdministratorPrompt(displayedOrder, item)}
          onCancelOrder={() => cancelAfterPartialRejection(displayedOrder)}
          onEdit={() => startEditOrder(displayedOrder)}
          splitModes={splitModes}
          onSplitOrder={(mode) => mode === 'items' ? showSplitOrder(displayedOrder) : void goToPayment(displayedOrder, mode)}
          fulfillmentEditor={canCreateDelivery && canWork && displayedOrder.updatedAt && displayedOrder.source !== 'qr' && displayedOrder.source !== 'pickup' &&
            !displayedOrder.externalOrderId && !displayedOrder.splitFromOrderId && relatedChecks.length <= 1 &&
            ['sent_to_kitchen', 'ready'].includes(displayedOrder.status) &&
            displayedOrder.items.every((item) => ['new', 'cancelled', 'rejected'].includes(item.status) || item.prepStation === 'none') &&
            waiterOrderPermission(displayedOrder, 'edit', settings.data?.waiterOrderPermissions).allowed ? (
              <EditOrderFulfillment order={displayedOrder} tables={halls.flatMap((hall) => hall.tables
                .filter((table) => table.id === displayedOrder.table.id || table.status === 'free')
                .map((table) => ({ value: table.id, label: `${tableLabel(table)} · ${hall.name}` })))}
                onUpdated={(updated) => { selectOrderCart(updated); setViewingOrderId(updated.id); }} />
            ) : undefined}
          relatedChecks={relatedChecks}
          onSelectCheck={(id) => { setSelectedCheckId(id); setViewingOrderId(id); }}
        />
      ) : (
        <CartPanel
          table={selectedTable}
          delivery={!!deliveryCart}
          typeLabel={t(orderTypeLabel(currentOrderType))}
          typeControl={typeControl}
          roundTotal={roundCart}
          hallName={selectedHallName}
          mode={editing ? 'edit' : activeOrder ? 'add' : 'create'}
          orderNumber={activeOrder?.orderNumber}
          submitting={create.isPending || addItems.isPending || editOrder.isPending}
          canSubmit={canWork}
          sendLabel={cartSendLabel}
          onSubmit={() => void (editing ? saveEditOrder() : submitCart())}
          onCancelEdit={cancelEditing}
          onBlockedSubmit={() =>
            push({ message: t('Сначала начните смену в профиле.'), type: 'error', at: new Date().toISOString() })
          }
        />
      )}
    </Panel>
  );

  const canViewAllOrders = canAction('viewAllOrders');
  const showRegister = canViewAllOrders && showAllOrders;
  const ordersHeading = t(showRegister ? 'Все заказы' : 'Активные заказы');
  const registerPanel = <div data-orders-scroll className="orders-workspace min-h-0 flex-1 overflow-auto">
    <OrdersPage scope="terminal" />
  </div>;

  const ordersActions = (
    <div className="flex flex-wrap items-center gap-2">
      {canViewAllOrders && <button type="button" className="btn-secondary btn-md"
        onClick={() => setShowAllOrders(!showRegister)}>{t(showRegister ? 'Мои активные' : 'Все заказы')}</button>}
    </div>
  );

  const profilePanel = (
    <WaiterProfile
      shift={activeShift}
      trackShift={trackShift}
      shiftLoading={currentShiftQ.isFetching}
      shiftPending={shiftPending}
      shiftRequest={shiftRequest.data?.status}
      onStartShift={() =>
        runAction(async () => {
          const started = await startShift.mutateAsync();
          if (!started) await shiftRequest.refetch();
          push({ message: started ? t('Смена начата') : 'Запрос на начало смены отправлен', type: 'success', at: new Date().toISOString() });
        })
      }
      onEndShift={() =>
        runAction(async () => {
          const ended = await endShift.mutateAsync();
          setShiftSummary(ended);
        })
      }
      pushStatus={pushNotifications.status}
      onEnablePush={pushNotifications.enable}
      onOpenCabinet={() => setCabinetOpen(true)}
    />
  );

  // Личный кабинет официанта — отдельный экран поверх вкладки «Профиль».
  const cabinetNode = (
    <WaiterCabinet onBack={() => setCabinetOpen(false)} onOpenHistory={() => setOrderArchiveOpen(true)} />
  );

  const desktopView: DesktopTab = activeNavTab === 'orders' || activeNavTab === 'profile' ? activeNavTab : 'tables';

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Шапка */}
      <div className="relative shrink-0">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-white py-2 pl-2 pr-4 sm:pl-4 xl:flex-nowrap xl:gap-4">
        <div className="flex items-center gap-2">
          <BrandLogo />
        </div>
        <DesktopNav current={desktopView} onChange={(next) => changeTab(next)} />
        <div className="flex items-center gap-3">
          <TerminalFunctionsButton open={functionsOpen} onOpen={() => setFunctionsOpen(true)} />
          <ConnectionStatus />
          <span className="hidden text-sm text-text-secondary sm:inline">{user?.name}</span>
        </div>
      </header>
      <WorkspaceLinks current="terminal" />
      <OfflineBanner inHeader />
      </div>
      <CashShiftBanner
        promptOnEntry={canWork && !showShiftGate && tab !== 'profile' && !paymentOrder && !splitOrder
          && !functionsOpen && !orderArchiveOpen && !printQueueOpen}
        editor={cashShiftEditor}
        setEditor={setCashShiftEditor}
      />

      {showPushBanner && (
        <BackgroundPushBanner onEnable={pushNotifications.enable} />
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
      {/* DESKTOP: 3 колонки */}
      <main className="hidden min-w-0 flex-1 gap-2 overflow-hidden p-2 md:flex xl:gap-4 xl:p-4">
        {desktopView === 'tables' ? (
          <>
            <div className="min-w-0 w-[22%] max-w-[360px] shrink-0">{tablesPanel}</div>
            <div className="min-w-0 flex-1">{menuPanel}</div>
            <div className="min-w-0 w-[26%] max-w-[380px] shrink-0">{rightPanel}</div>
          </>
        ) : desktopView === 'orders' ? (
          <div className={`mx-auto flex h-full w-full flex-col overflow-hidden ${showRegister ? '' : 'max-w-3xl'}`}>
            {viewingOrder ? (
              <div className="mx-auto h-full w-full max-w-xl">{rightPanel}</div>
            ) : (
              <>
                <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-text-primary">{ordersHeading}</h2>
                  {ordersActions}
                </div>
                {showRegister ? (wideLayout ? registerPanel : null) : <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
                  <OrdersList
                    orders={orders}
                    onOpen={openExistingOrder}
                    onClaimQr={claimQr}
                    claimPending={claimQrOrder.isPending}
                    onEdit={startEditOrder}
                    onCancel={requestOrderCancellation}
                  />
                </div>}
              </>
            )}
          </div>
        ) : (
          <div className="no-scrollbar mx-auto h-full w-full max-w-xl overflow-y-auto py-2">
            {cabinetOpen ? cabinetNode : profilePanel}
          </div>
        )}
      </main>

      {/* MOBILE: одна панель + нижняя навигация */}
      <main className="flex-1 overflow-hidden bg-white px-1 pb-0 pt-0.5 md:hidden">
        {tab === 'tables' && tablesPanel}
        {tab === 'menu' && mobileMenuNode}
        {tab === 'cart' && rightPanel}
        {tab === 'orders' && (
          viewingOrder ? (
            rightPanel
          ) : (
            <Panel title={ordersHeading} action={ordersActions}>
              {showRegister ? (!wideLayout ? registerPanel : null) : <div className="no-scrollbar overflow-y-auto">
                <OrdersList
                  orders={orders}
                  onOpen={openExistingOrder}
                  onClaimQr={claimQr}
                  claimPending={claimQrOrder.isPending}
                  onEdit={startEditOrder}
                  onCancel={requestOrderCancellation}
                />
              </div>}
            </Panel>
          )
        )}
        {tab === 'profile' &&
          (cabinetOpen ? (
            <div className="no-scrollbar h-full overflow-y-auto px-1 py-1">{cabinetNode}</div>
          ) : (
            <Panel title={t('Профиль')}>
              <div className="no-scrollbar overflow-y-auto">{profilePanel}</div>
            </Panel>
          ))}
      </main>

      {/* Оверлей «Смена не начата» поверх контента вкладок (нижняя навигация остаётся видна) */}
      {showShiftGate && (
        <div className="absolute inset-0 z-30">
          <ShiftRequiredScreen onBusyChange={setShiftBusy} request={shiftRequest.data?.status} startShift={async () => {
            const started = await startShift.mutateAsync();
            if (!started) await shiftRequest.refetch();
            return started;
          }} />
        </div>
      )}
      </div>

      {/* Корзина над нижней навигацией (только на экране меню) */}
      {tab === 'menu' && !replacementTarget && !showShiftGate && (
        <MenuCartBar
          count={cart.lines.length}
          canOpenEmpty={newDelivery}
          total={cartTotals(cart.lines, roundCart).final}
          submitting={create.isPending || addItems.isPending || editOrder.isPending}
          submitLabel={cartSubmitLabel}
          onOpenCart={() => setCartSheetOpen(true)}
          onSubmit={() => void (editing ? saveEditOrder() : submitCart())}
        />
      )}

      {/* Корзина как bottom sheet поверх меню */}
      {modifierLine && <ModifierPicker key={modifierLine.dish.id} line={modifierLine} onClose={() => setModifierLine(null)} onConfirm={(modifiers) => {
        if (modifierLine.set) addSetToCart(modifierLine.dish, modifierLine.set.components, modifiers);
        else addDishToCart(modifierLine.dish, modifierLine.variant, modifierLine.weightGrams, modifiers);
        setModifierLine(null);
      }} />}
      <CartSheet
        open={!wideLayout && cartSheetOpen && tab === 'menu' && canUseMenu && !replacementTarget}
        onClose={() => setCartSheetOpen(false)}
        submitting={create.isPending || addItems.isPending || editOrder.isPending}
        canSubmit={canWork}
        delivery={!!deliveryCart}
        typeControl={typeControl}
        roundTotal={roundCart}
        submitLabel={cartSubmitLabel}
        onSubmit={async () => {
          await (editing ? saveEditOrder() : submitCart());
          if (!newDelivery || !useCart.getState().target) setCartSheetOpen(false);
        }}
      />

      {/* Блок отмены действия с таймером — пока отмена заказа не ушла на сервер */}
      {pendingCancel && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6 md:px-5">
          <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3.5 rounded-2xl border border-border bg-white px-4 py-3.5 shadow-soft sm:px-5">
            <UndoActionIcon />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-text-primary">
                {displayOrderNumber(pendingCancel.order.orderNumber)} · {orderPlaceLabel(pendingCancel.order, t)} — {t('отмена заказа')}
              </p>
              <p className="text-[13px] text-text-muted">
                {t('Отменится через')}{' '}
                <span className="font-semibold text-danger">
                  {String(Math.max(0, Math.ceil((pendingCancel.deadline - now) / 1000))).padStart(2, '0')} {t('сек')}
                </span>
              </p>
            </div>
            <button
              onClick={undoCancel}
              className="shrink-0 rounded-xl border border-primary bg-white px-5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              {t('Вернуть')}
            </button>
          </div>
        </div>
      )}

      <BottomNav tab={activeNavTab} setTab={changeTab} ordersCount={ordersAttentionCount} />

      {orderArchiveOpen && <WaiterOrderArchive
        titleActions={<TerminalFunctionsButton open={functionsOpen} onOpen={() => setFunctionsOpen(true)} />}
        onClose={() => setOrderArchiveOpen(false)}
        onNewOrder={() => {
          setOrderArchiveOpen(false);
          setEditingOrderId(null);
          setSelectedCheckId(null);
          cart.select(null);
          changeTab('tables');
        }}
        canStartOrder={canWork}
        onPrint={canPrintReceipts || canRequestPrint ? (order) => void requestOrderReceipt(order, 'receipt') : undefined}
        printing={printingReceipt || createPrintRequest.isPending}
      />}

      {functionsOpen && <TerminalFunctions
        onClose={() => setFunctionsOpen(false)}
        onArchive={orderArchiveOpen ? undefined : () => setOrderArchiveOpen(true)}
        onAllOrders={canViewAllOrders ? () => {
          setOrderArchiveOpen(false);
          changeTab('orders');
          setShowAllOrders(true);
        } : undefined}
        onPrintQueue={canHandlePrintQueue ? () => setPrintQueueOpen(true) : undefined}
        canWork={canWork}
        onCashShift={(editor) => {
          setOrderArchiveOpen(false);
          setCashShiftEditor(editor);
        }}
        onDelivery={canCreateDelivery ? () => {
          setOrderArchiveOpen(false);
          startDelivery();
        } : undefined}
        onProfile={() => {
          setOrderArchiveOpen(false);
          changeTab('profile');
        }}
      />}

      {canHandlePrintQueue && canWork && printQueueOpen && (
        <Modal open title={t('Печать чека')} onClose={() => setPrintQueueOpen(false)} panelClassName="max-w-5xl max-h-[90dvh]">
          <ReceiptPrintsPage terminal />
        </Modal>
      )}

      {canTakePayment && paymentOrder && (
        <PaymentModal
          key={paymentOrder.id}
          order={paymentOrder}
          wideLayout={wideLayout}
          initialSplitMode={paymentSplitMode}
          open={!!paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onPaid={() => finishPayment(paymentOrder)}
        />
      )}

      {splitOrder && canTakePayment && <SplitOrderModal order={splitOrder}
        onClose={() => setSplitOrder(null)} onSplit={showNewCheck} />}

      <CancelOrderModal
        open={!!cancelTarget}
        order={cancelTarget}
        submitting={cancelOrder.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancelOrder}
      />

      <audio ref={administratorPromptAudio} src="/sounds/call-administrator.mp3" preload="auto" />
      <InsufficientPermissionsModal
        key={administratorCallTarget?.item?.id ?? administratorCallTarget?.order.id ?? 'closed'}
        open={!!administratorCallTarget}
        onClose={closeAdministratorPrompt}
        onCallAdministrator={callAdministrator}
        itemName={administratorCallTarget?.item ? orderItemName(administratorCallTarget.item) : undefined}
        onRequestCancellation={administratorCallTarget?.item ? requestItemCancellation : undefined}
        requestError={itemCancellation.error ? apiError(itemCancellation.error) : undefined}
        submitting={administratorCall.isPending || itemCancellation.isPending}
      />

      {/* Нижний лист «Печать чека» (ожидание / распечатан / отклонён) */}
      <ReceiptPrintSheet />

      {/* Итоги смены после её завершения */}
      <ShiftSummaryModal
        shift={shiftSummary}
        open={!!shiftSummary}
        onClose={() => setShiftSummary(null)}
      />

      {/* Смена стола на экране меню */}
      {tablePickerOpen && (
        <TableSelectModal
          halls={halls}
          currentTableId={selectedTableId}
          onPick={pickMenuTable}
          onClose={() => { setTablePickerOpen(false); setChoosingDineInTable(false); }}
          useMap={settings.data?.useFloorPlan}
        />
      )}

      {/* Подтверждение переноса непустой корзины на другой стол */}
      {pendingTableId && (
        <Modal
          open
          onClose={() => setPendingTableId(null)}
          title={t('Сменить стол?')}
          footer={
            <div className="flex gap-2">
              <button className="btn-secondary btn-lg flex-1" onClick={() => setPendingTableId(null)}>
                {t('Отмена')}
              </button>
              <button className="btn-primary btn-lg flex-1 font-semibold" onClick={confirmMoveCart}>
                {t('Перенести')}
              </button>
            </div>
          }
        >
          <p className="text-sm text-text-secondary">
            {t('В корзине уже есть блюда. Перенести корзину на другой стол?')}
          </p>
        </Modal>
      )}

      {/* Действия со столом */}
      {tableModal === 'close' && selectedTable && (
        <CloseTableModal
          table={selectedTable}
          hasActiveOrder={!!activeOrder}
          pending={closeTable.isPending}
          onConfirm={doCloseTable}
          onClose={() => setTableModal(null)}
        />
      )}
      {tableModal === 'move' && selectedTable && (
        <MoveTableModal
          halls={halls}
          currentTableId={selectedTable.id}
          pending={moveTable.isPending}
          onConfirm={doMoveTable}
          onClose={() => setTableModal(null)}
        />
      )}
      {tableModal === 'transfer' && selectedTable && (
        <TransferTableModal
          waiters={availableWaitersQ.data ?? []}
          loading={availableWaitersQ.isLoading}
          excludeWaiterId={displayedOrder?.waiter?.id ?? user?.id ?? null}
          pending={transferTable.isPending}
          onConfirm={doTransferTable}
          onClose={() => setTableModal(null)}
        />
      )}
    </div>
  );
}

function UndoActionIcon() {
  return <img src="/undo-action-icon.png" width={48} height={48} className="h-12 w-12 shrink-0" alt="" />;
}

function Panel({
  title,
  action,
  children,
}: {
  title: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex h-full flex-col bg-white px-1 ${title || action ? 'py-2' : 'pb-0 pt-0.5'} md:rounded-2xl md:border md:border-border/60 md:bg-card md:p-2 md:shadow-card xl:p-4`}>
      {(title || action) && (
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function BackgroundPushBanner({ onEnable }: { onEnable: () => void }) {
  const t = useT();
  return (
    <div className="shrink-0 border-b border-border bg-warning/10 px-3 py-2">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t('Фоновые уведомления выключены')}</p>
          <p className="truncate text-xs text-text-muted">
            {t('Включите уведомления, чтобы слышать готовность заказа в фоне.')}
          </p>
        </div>
        <button className="btn-primary btn-md shrink-0" onClick={onEnable}>
          {t('Включить')}
        </button>
      </div>
    </div>
  );
}

function DesktopNav({
  current,
  onChange,
}: {
  current: DesktopTab;
  onChange: (tab: DesktopTab) => void;
}) {
  const t = useT();
  const items: { key: DesktopTab; label: string }[] = [
    { key: 'tables', label: 'Столы / Заказ' },
    { key: 'orders', label: 'Заказы' },
    { key: 'profile', label: 'Профиль' },
  ];

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const active = current === item.key;
        return (
          <button
            key={item.key}
            className={`rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:bg-background hover:text-text-primary'
            }`}
            onClick={() => onChange(item.key)}
          >
            {t(item.label)}
          </button>
        );
      })}
    </nav>
  );
}

const NAV: { key: Tab; label: string; icon: JSX.Element }[] = [
  { key: 'tables', label: 'Столы', icon: <IconGrid /> },
  { key: 'menu', label: 'Меню', icon: <IconMenu /> },
  { key: 'orders', label: 'Заказы', icon: <IconList /> },
  { key: 'profile', label: 'Профиль', icon: <IconUser /> },
];

function BottomNav({
  tab,
  setTab,
  ordersCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  ordersCount: number;
}) {
  const t = useT();
  return (
    <nav className="relative z-50 grid shrink-0 grid-cols-4 border-t border-border bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      {NAV.map((n) => {
        const active = tab === n.key;
        const badge = n.key === 'orders' ? ordersCount : 0;
        return (
          <button
            key={n.key}
            onClick={() => setTab(n.key)}
            className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] ${
              active ? 'text-primary' : 'text-text-muted'
            }`}
          >
            <span className="relative">
              {n.icon}
              {badge > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-white">
                  {badge}
                </span>
              )}
            </span>
            {t(n.label)}
          </button>
        );
      })}
    </nav>
  );
}

function pozLabel(n: number): string {
  const a = Math.abs(n) % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return 'позиций';
  if (b === 1) return 'позиция';
  if (b >= 2 && b <= 4) return 'позиции';
  return 'позиций';
}

function MenuCartBar({
  count,
  canOpenEmpty,
  total,
  submitting,
  submitLabel,
  onOpenCart,
  onSubmit,
}: {
  count: number;
  canOpenEmpty: boolean;
  total: number;
  submitting: boolean;
  submitLabel: string;
  onOpenCart: () => void;
  onSubmit: () => void;
}) {
  const hasItems = count > 0;
  return (
    <div className="shrink-0 border-t border-border bg-white px-2 py-2 md:hidden">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenCart}
          disabled={!hasItems && !canOpenEmpty}
          className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-left transition-colors enabled:hover:border-primary/40 disabled:opacity-60"
        >
          <span className="text-text-secondary">
            <IconCart />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[11px] text-text-muted">
              {count} {pozLabel(count)}
            </span>
            <NumberTicker value={total} className="block text-sm font-semibold text-text-primary" />
          </span>
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!hasItems || submitting}
          className="btn-primary h-12 flex-1 rounded-lg font-semibold disabled:opacity-50"
        >
          {submitting ? <Spinner /> : submitLabel}
        </button>
      </div>
    </div>
  );
}

function IconGrid() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}
function IconCart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 4h2l2.4 12.3a1 1 0 0 0 1 .7h8.7a1 1 0 0 0 1-.8L21 8H6" />
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
