import { useEffect, useMemo, useState } from 'react';
import type { Order, CartLine, DishVariant, WaiterShift } from '@/types';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { clientId } from '@/lib/id';
import { displayOrderNumber, hallSuffix } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useWaiterPushNotifications } from '@/lib/push';
import { useNotifications } from '@/store/notifications';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { FullScreenLoader, Spinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { NumberTicker } from '@/components/NumberTicker';
import { useCart, cartLineKey, cartLineKeyFromParts, cartTotals } from './cart';
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
  useRemoveRejectedItem,
  useCancelReadyItem,
  useReplaceRejectedItem,
  useCancelOrder,
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
import { useReceiptPrint } from './receiptPrint';
import { TablesGrid } from './TablesGrid';
import { DishMenu } from './DishMenu';
import { CartPanel } from './CartPanel';
import { CartSheet } from './CartSheet';
import { cartStations } from '@/lib/prep-station';
import { OrderPanel } from './OrderPanel';
import { OrdersList } from './OrdersList';
import { WaiterProfile } from './WaiterProfile';
import { WaiterCabinet } from './WaiterCabinet';
import { PaymentModal } from './PaymentModal';
import { ReceiptPrintSheet } from './ReceiptPrintSheet';
import { ShiftSummaryModal } from './ShiftSummaryModal';
import { CancelOrderModal } from './CancelOrderModal';
import {
  TableActionsMenu,
  TableChip,
  TableSelectButton,
  TableSelectModal,
  CloseTableModal,
  MoveTableModal,
  TransferTableModal,
} from './TableActions';

type Tab = 'tables' | 'menu' | 'cart' | 'orders' | 'profile';
type DesktopTab = 'tables' | 'orders' | 'profile';

/** Сколько секунд показывается блок отмены действия, прежде чем отмена заказа уйдёт на сервер. */
const CANCEL_UNDO_SECONDS = 6;
type PendingCancel = { order: Order; reason: string; deadline: number };
type ReplacementTarget = { order: Order; item: Order['items'][number] };

export function WaiterApp() {
  useWaiterRealtime();
  const user = useAuth((s) => s.user);
  const push = useNotifications((s) => s.push);
  const t = useT();
  const pushNotifications = useWaiterPushNotifications(user?.role === 'WAITER');

  const hallsQ = useHalls();
  const categoriesQ = useCategories();
  const dishesQ = useDishes();
  const ordersQ = useActiveOrders();
  const currentShiftQ = useCurrentShift();

  const cart = useCart();
  const create = useCreateOrder();
  const addItems = useAddItems();
  const editOrder = useEditOrder();
  const pickedUp = usePickedUp();
  const served = useServed();
  const toPayment = useToPayment();
  const resolvePartialRejection = useResolvePartialRejection();
  const removeRejectedItem = useRemoveRejectedItem();
  const cancelReadyItem = useCancelReadyItem();
  const replaceRejectedItem = useReplaceRejectedItem();
  const cancelOrder = useCancelOrder();
  const startShift = useStartShift();
  const endShift = useEndShift();
  const closeTable = useCloseTable();
  const moveTable = useMoveTable();
  const transferTable = useTransferTable();
  const createPrintRequest = useCreateReceiptPrintRequest();
  const beginPrint = useReceiptPrint((s) => s.begin);

  const [tab, setTab] = useState<Tab>('tables');
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<WaiterShift | null>(null);
  const [tableModal, setTableModal] = useState<'close' | 'move' | 'transfer' | null>(null);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [replacementTarget, setReplacementTarget] = useState<ReplacementTarget | null>(null);
  const [idemKey, setIdemKey] = useState(() => clientId());
  const [addItemsIdemKey, setAddItemsIdemKey] = useState(() => clientId());

  const availableWaitersQ = useAvailableWaiters(tableModal === 'transfer');

  const halls = hallsQ.data ?? [];
  const orders = ordersQ.data ?? [];
  const activeShift = currentShiftQ.data ?? null;

  // Самый свежий активный заказ по каждому столу (бэкенд отдаёт по убыванию даты).
  const ordersByTable = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of orders) if (!m.has(o.table.id)) m.set(o.table.id, o);
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

  const selectedTable =
    halls.flatMap((h) => h.tables).find((t) => t.id === cart.tableId) ?? null;
  const selectedHallName = selectedTable
    ? halls.find((h) => h.id === selectedTable.hallId)?.name
    : undefined;
  const activeOrder = cart.tableId ? ordersByTable.get(cart.tableId) : undefined;
  const editing = !!editingOrderId && !!activeOrder && activeOrder.id === editingOrderId;
  const viewingOrder = viewingOrderId ? orders.find((o) => o.id === viewingOrderId) : undefined;
  const displayedOrder = viewingOrder ?? activeOrder;
  const showCart = !viewingOrder && (cart.lines.length > 0 || !activeOrder);
  const activeNavTab: Tab = viewingOrder && tab === 'cart' ? 'orders' : tab;
  // Направления позиций корзины. Только «Без отправки» → готовить нечего,
  // кнопка вместо «Отправить на кухню» становится «Добавить в заказ».
  const cartStationInfo = cartStations(cart.lines, categoriesQ.data ?? []);
  const cartOnlyNone = cart.lines.length > 0 && !cartStationInfo.hasPrep;
  // Подпись отправки нового заказа: есть кухня (в т.ч. смешанно) → «на кухню»,
  // только бар → «в бар», только без отправки → «Добавить в заказ».
  const cartSendLabel = cartOnlyNone
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
    setTablePickerOpen(false);
    if (tableId === cart.tableId) return;
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

  // --- Редактирование заказа (Фаза 1: только пока кухня не приняла заказ) ---
  function startEditOrder(order: Order) {
    setViewingOrderId(null);
    cart.selectTable(order.table.id);
    const dishById = new Map((dishesQ.data ?? []).map((d) => [d.id, d]));
    const lines = order.items
      .filter((it) => it.status !== 'rejected' && it.status !== 'cancelled')
      .map((it) => {
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
            return {
              componentId: def?.id ?? sc.id,
              originalDishId: sc.originalDishId ?? '',
              originalVariantId: def?.dishVariant?.id,
              originalName: sc.originalVariantNameSnapshot
                ? `${sc.originalNameSnapshot} ${sc.originalVariantNameSnapshot}`
                : sc.originalNameSnapshot,
              quantity: sc.quantity,
              removable: def?.removable ?? true,
              replaceable: def?.replaceable ?? true,
              action: sc.action,
              finalDishId: sc.finalDishId ?? undefined,
              finalName: sc.finalNameSnapshot ?? undefined,
            };
          });
          return {
            dish,
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
          dish,
          variant,
          quantity: it.quantity,
          comment: it.comment ?? undefined,
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
      await editOrder.mutateAsync({ orderId: editingOrderId, comment: cart.comment, lines: cart.lines });
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

  function commitCancel(p: PendingCancel) {
    cancelOrder
      .mutateAsync({ orderId: p.order.id, reason: p.reason })
      .then(() => push({ message: t('Заказ отменён'), type: 'success', at: new Date().toISOString() }))
      .catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() }));
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
    cart.selectTable(order.table.id);
    setTab(order.requiresWaiterDecision ? 'orders' : 'cart');
    if (order.status === 'waiting_payment') {
      setPaymentOrder(order);
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
      cart.selectTable(updated.table.id);
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

  function addDishToCart(dish: Parameters<typeof cart.add>[0], variant?: DishVariant) {
    if (dish.trackInventory) {
      const currentQty = (variant ? cartQuantities[variant.id] : cartQuantities[dish.id]) ?? 0;
      const stock = variant ? variant.stock : dish.stock;
      if (stock !== undefined && stock !== null && currentQty >= stock) {
        push({ message: `Недостаточно на складе. Остаток: ${stock}`, type: 'error', at: new Date().toISOString() });
        return;
      }
    }

    if (replacementTarget) {
      void replaceRejectedWithLine({ dish, variant, quantity: 1 });
      return;
    }

    const key = cartLineKeyFromParts(dish.id, variant?.id);
    const nextQuantity = (cart.lines.find((line) => cartLineKeyFromParts(line.dish.id, line.variant?.id) === key)?.quantity ?? 0) + 1;
    cart.add(dish, variant);
    const name = variant ? `${dish.name} · ${variant.name}` : dish.name;
    push({ message: `${name} ×${nextQuantity} добавлено`, at: new Date().toISOString(), durationMs: 1800 });
  }

  function addSetToCart(set: Parameters<typeof cart.addSet>[0], components: Parameters<typeof cart.addSet>[1]) {
    if (replacementTarget) {
      void replaceRejectedWithLine({
        dish: set,
        quantity: 1,
        lineId: `set-replacement-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        set: { components },
      });
      return;
    }
    cart.addSet(set, components);
    push({ message: `${set.name} добавлен`, at: new Date().toISOString(), durationMs: 1800 });
  }

  async function goToPayment(order: Order) {
    try {
      const updated = await toPayment.mutateAsync(order.id);
      setPaymentOrder(updated);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  // «Счёт»: создаём запрос на печать предварительного расчёта (тот же поток
  // подтверждения администратором, что и обычный чек) и открываем лист ожидания.
  async function requestPreliminaryReceipt(order: Order) {
    try {
      const [request, receipt] = await Promise.all([
        createPrintRequest.mutateAsync({ orderId: order.id, type: 'preliminary' }),
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
    cart.selectTable(order.table.id);
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
      cart.selectTable(updated.table.id);
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
      cart.selectTable(updated.table.id);
      setTab('orders');
      push({ message: `${orderItemName(item)} отменено`, type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function cancelAfterPartialRejection(order: Order) {
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
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function submitCart() {
    if (!selectedTable) return;
    if (!activeShift) {
      push({ message: t('Сначала начните смену в профиле.'), type: 'error', at: new Date().toISOString() });
      return;
    }
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
      } else {
        await create.mutateAsync({
          tableId: selectedTable.id,
          comment: cart.comment,
          idempotencyKey: idemKey,
          lines: cart.lines,
        });
        cart.clear();
        setIdemKey(clientId());
        push({
          message: cartOnlyNone ? t('Заказ создан') : t('Заказ отправлен на кухню'),
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
      push({ message: `${t('Заказ перенесён на стол')} №${updated.table.number}`, type: 'success', at: new Date().toISOString() });
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
      <TablesGrid halls={halls} selectedTableId={cart.tableId} onSelect={selectTable} />
    </Panel>
  );

  // Десктоп: меню в панели с заголовком и чипом стола.
  const menuPanel = (
    <Panel title={t('Меню')} action={selectedTable ? <TableChip number={selectedTable.number} hallName={selectedHallName} /> : null}>
      <DishMenu
        categories={categoriesQ.data ?? []}
        dishes={dishesQ.data ?? []}
        quantities={cartQuantities}
        lineCounts={cartLineCounts}
        onAdd={addDishToCart}
        onAddSet={addSetToCart}
        onDec={(d) => decDishFromMenu(d.id)}
        disabled={!selectedTable}
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
        disabled={!selectedTable}
        tableSlot={
          selectedTable ? (
            <TableSelectButton number={selectedTable.number} hallName={selectedHallName} onClick={() => setTablePickerOpen(true)} />
          ) : null
        }
      />
    </section>
  );

  const rightPanel = (
    <Panel title={null}>
      {!selectedTable ? (
        <EmptyHint text={t('Выберите стол, чтобы открыть заказ')} />
      ) : displayedOrder && !showCart ? (
        <OrderPanel
          order={displayedOrder}
          submitting={actionPending}
          preliminaryPending={createPrintRequest.isPending}
          onPickedUp={() => runAction(() => pickedUp.mutateAsync(displayedOrder.id))}
          onServed={() => runAction(() => served.mutateAsync(displayedOrder.id))}
          onToPayment={() => goToPayment(displayedOrder)}
          onPreliminaryReceipt={() => requestPreliminaryReceipt(displayedOrder)}
          onContinueAfterRejection={() => continueAfterPartialRejection(displayedOrder)}
          onReplaceRejectedItem={(item) => replaceRejectedFromOrder(displayedOrder, item)}
          onRemoveRejectedItem={(item) => removeRejectedFromOrder(displayedOrder, item)}
          onCancelReadyItem={(item, reason) => cancelReadyItemFromOrder(displayedOrder, item, reason)}
          onCancelOrder={() => cancelAfterPartialRejection(displayedOrder)}
          onEdit={() => startEditOrder(displayedOrder)}
        />
      ) : (
        <CartPanel
          table={selectedTable}
          hallName={selectedHallName}
          mode={editing ? 'edit' : activeOrder ? 'add' : 'create'}
          orderNumber={activeOrder?.orderNumber}
          submitting={create.isPending || addItems.isPending || editOrder.isPending}
          canSubmit={!!activeShift}
          sendLabel={cartSendLabel}
          onSubmit={editing ? saveEditOrder : submitCart}
          onCancelEdit={cancelEditing}
          onBlockedSubmit={() =>
            push({ message: t('Сначала начните смену в профиле.'), type: 'error', at: new Date().toISOString() })
          }
        />
      )}
    </Panel>
  );

  const profilePanel = (
    <WaiterProfile
      shift={activeShift}
      shiftLoading={currentShiftQ.isFetching}
      shiftPending={shiftPending}
      onStartShift={() =>
        runAction(async () => {
          await startShift.mutateAsync();
          push({ message: t('Смена начата'), type: 'success', at: new Date().toISOString() });
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
    <WaiterCabinet onBack={() => setCabinetOpen(false)} onViewAll={() => changeTab('orders')} />
  );

  const desktopView: DesktopTab = activeNavTab === 'orders' || activeNavTab === 'profile' ? activeNavTab : 'tables';

  return (
    <div className="flex h-full flex-col bg-background">
      <OfflineBanner />

      {/* Шапка */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-white py-2 pl-2 pr-4 sm:pl-4">
        <div className="flex items-center gap-2">
          <BrandLogo />
        </div>
        <DesktopNav current={desktopView} onChange={(next) => changeTab(next)} />
        <div className="flex items-center gap-3">
          <ConnectionStatus />
          <span className={`text-xs ${activeShift ? 'text-success' : 'text-text-muted'}`}>
            <span className="hidden sm:inline">{activeShift ? t('Смена активна') : t('Смена не начата')}</span>
            <span className="sm:hidden">{activeShift ? t('Смена активна') : t('Нет смены')}</span>
          </span>
          <span className="hidden text-sm text-text-secondary sm:inline">{user?.name}</span>
        </div>
      </header>

      {showPushBanner && (
        <BackgroundPushBanner onEnable={pushNotifications.enable} />
      )}

      {/* DESKTOP: 3 колонки */}
      <main className="hidden flex-1 gap-4 overflow-hidden p-4 lg:flex">
        {desktopView === 'tables' ? (
          <>
            <div className="w-[360px] shrink-0">{tablesPanel}</div>
            <div className="min-w-0 flex-1">{menuPanel}</div>
            <div className="w-[380px] shrink-0">{rightPanel}</div>
          </>
        ) : desktopView === 'orders' ? (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden">
            {viewingOrder ? (
              <div className="mx-auto h-full w-full max-w-xl">{rightPanel}</div>
            ) : (
              <>
                <h2 className="mb-3 shrink-0 text-lg font-semibold text-text-primary">{t('Активные заказы')}</h2>
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
                  <OrdersList
                    orders={orders}
                    onOpen={openExistingOrder}
                    onEdit={startEditOrder}
                    onCancel={(o) => setCancelTarget(o)}
                  />
                </div>
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
      <main className="flex-1 overflow-hidden bg-white px-1 py-2 lg:hidden">
        {tab === 'tables' && tablesPanel}
        {tab === 'menu' && mobileMenuNode}
        {tab === 'cart' && rightPanel}
        {tab === 'orders' && (
          viewingOrder ? (
            rightPanel
          ) : (
            <Panel title={t('Активные заказы')}>
              <div className="no-scrollbar overflow-y-auto">
                <OrdersList
                  orders={orders}
                  onOpen={openExistingOrder}
                  onEdit={startEditOrder}
                  onCancel={(o) => setCancelTarget(o)}
                />
              </div>
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

      {/* Корзина над нижней навигацией (только на экране меню) */}
      {tab === 'menu' && !replacementTarget && (
        <MenuCartBar
          count={cart.lines.length}
          total={cartTotals(cart.lines).final}
          submitting={create.isPending || addItems.isPending || editOrder.isPending}
          submitLabel={cartSubmitLabel}
          onOpenCart={() => setCartSheetOpen(true)}
          onSubmit={editing ? saveEditOrder : submitCart}
        />
      )}

      {/* Корзина как bottom sheet поверх меню */}
      <CartSheet
        open={cartSheetOpen && tab === 'menu' && !replacementTarget}
        onClose={() => setCartSheetOpen(false)}
        submitting={create.isPending || addItems.isPending || editOrder.isPending}
        canSubmit={!!activeShift}
        submitLabel={cartSubmitLabel}
        onSubmit={async () => {
          await (editing ? saveEditOrder() : submitCart());
          setCartSheetOpen(false);
        }}
      />

      {/* Блок отмены действия с таймером — пока отмена заказа не ушла на сервер */}
      {pendingCancel && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6 lg:px-5">
          <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3.5 rounded-2xl border border-border bg-white px-4 py-3.5 shadow-soft sm:px-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" />
                <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-text-primary">
                {displayOrderNumber(pendingCancel.order.orderNumber)} · {t('Стол')} {pendingCancel.order.table.number}{hallSuffix(pendingCancel.order.table)} — {t('отмена заказа')}
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

      {paymentOrder && (
        <PaymentModal
          order={paymentOrder}
          open={!!paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onPaid={() => {
            setPaymentOrder(null);
            setViewingOrderId(null);
            setTab('tables');
          }}
        />
      )}

      <CancelOrderModal
        open={!!cancelTarget}
        order={cancelTarget}
        submitting={cancelOrder.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancelOrder}
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
          currentTableId={cart.tableId}
          onPick={pickMenuTable}
          onClose={() => setTablePickerOpen(false)}
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
          tableNumber={selectedTable.number}
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
    <section className="flex h-full flex-col bg-white px-1 py-2 lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-4 lg:shadow-card">
      {(title || action) && (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
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

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
      {text}
    </div>
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
    <nav className="hidden items-center gap-1 lg:flex">
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
    <nav className="relative z-50 grid shrink-0 grid-cols-4 border-t border-border bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
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
  total,
  submitting,
  submitLabel,
  onOpenCart,
  onSubmit,
}: {
  count: number;
  total: number;
  submitting: boolean;
  submitLabel: string;
  onOpenCart: () => void;
  onSubmit: () => void;
}) {
  const hasItems = count > 0;
  return (
    <div className="shrink-0 border-t border-border bg-white px-2 py-2 lg:hidden">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenCart}
          disabled={!hasItems}
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
