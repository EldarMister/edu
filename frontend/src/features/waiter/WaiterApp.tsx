import { useMemo, useState } from 'react';
import type { Order } from '@/types';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { useWaiterPushNotifications } from '@/lib/push';
import { useNotifications } from '@/store/notifications';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { FullScreenLoader } from '@/components/Spinner';
import { useCart } from './cart';
import { useWaiterRealtime } from './useWaiterRealtime';
import {
  useHalls,
  useCategories,
  useDishes,
  useActiveOrders,
  useCurrentShift,
  useCreateOrder,
  useAddItems,
  usePickedUp,
  useServed,
  useToPayment,
  useResolvePartialRejection,
  useCancelOrder,
  useStartShift,
  useEndShift,
  useCloseTable,
  useMoveTable,
  useTransferTable,
  useAvailableWaiters,
  type AvailableWaiter,
} from './api';
import { TablesGrid } from './TablesGrid';
import { DishMenu } from './DishMenu';
import { CartPanel } from './CartPanel';
import { OrderPanel } from './OrderPanel';
import { OrdersList } from './OrdersList';
import { WaiterProfile } from './WaiterProfile';
import { PaymentModal } from './PaymentModal';
import {
  TableActionsMenu,
  TableChip,
  CloseTableModal,
  MoveTableModal,
  TransferTableModal,
} from './TableActions';

type Tab = 'tables' | 'menu' | 'cart' | 'orders' | 'profile';
type DesktopTab = 'tables' | 'orders' | 'profile';

export function WaiterApp() {
  useWaiterRealtime();
  const user = useAuth((s) => s.user);
  const push = useNotifications((s) => s.push);
  const pushNotifications = useWaiterPushNotifications(user?.role === 'WAITER');

  const hallsQ = useHalls();
  const categoriesQ = useCategories();
  const dishesQ = useDishes();
  const ordersQ = useActiveOrders();
  const currentShiftQ = useCurrentShift();

  const cart = useCart();
  const create = useCreateOrder();
  const addItems = useAddItems();
  const pickedUp = usePickedUp();
  const served = useServed();
  const toPayment = useToPayment();
  const resolvePartialRejection = useResolvePartialRejection();
  const cancelOrder = useCancelOrder();
  const startShift = useStartShift();
  const endShift = useEndShift();
  const closeTable = useCloseTable();
  const moveTable = useMoveTable();
  const transferTable = useTransferTable();

  const [tab, setTab] = useState<Tab>('tables');
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [tableModal, setTableModal] = useState<'close' | 'move' | 'transfer' | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [addItemsIdemKey, setAddItemsIdemKey] = useState(() => crypto.randomUUID());

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

  const selectedTable =
    halls.flatMap((h) => h.tables).find((t) => t.id === cart.tableId) ?? null;
  const activeOrder = cart.tableId ? ordersByTable.get(cart.tableId) : undefined;
  const viewingOrder = viewingOrderId ? orders.find((o) => o.id === viewingOrderId) : undefined;
  const displayedOrder = viewingOrder ?? activeOrder;
  const showCart = !viewingOrder && (cart.lines.length > 0 || !activeOrder);
  const activeNavTab: Tab = viewingOrder && tab === 'cart' ? 'orders' : tab;
  const ordersAttentionCount = orders.filter((o) =>
    o.requiresWaiterDecision || ['ready', 'rejected'].includes(o.status),
  ).length;

  const actionPending =
    pickedUp.isPending || served.isPending || toPayment.isPending || resolvePartialRejection.isPending || cancelOrder.isPending;
  const shiftPending = startShift.isPending || endShift.isPending;

  if (hallsQ.isLoading || categoriesQ.isLoading || dishesQ.isLoading || currentShiftQ.isLoading) {
    return <FullScreenLoader />;
  }

  function selectTable(tableId: string) {
    setViewingOrderId(null);
    cart.selectTable(tableId);
    setTab(ordersByTable.has(tableId) ? 'cart' : 'menu');
  }

  function changeTab(next: Tab) {
    setViewingOrderId(null);
    setTab(next);
  }

  function openExistingOrder(order: Order) {
    setViewingOrderId(order.id);
    cart.selectTable(order.table.id);
    setTab('cart');
    if (order.status === 'waiting_payment') {
      setPaymentOrder(order);
    }
  }

  function addDishToCart(dish: Parameters<typeof cart.add>[0]) {
    cart.add(dish);
    push({ message: 'Блюдо добавлено в корзину', at: new Date().toISOString() });
  }

  async function goToPayment(order: Order) {
    try {
      const updated = await toPayment.mutateAsync(order.id);
      setPaymentOrder(updated);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function continueAfterPartialRejection(order: Order) {
    try {
      await resolvePartialRejection.mutateAsync(order.id);
      push({ message: 'Заказ продолжен без отказанного блюда', type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  function addReplacement(order: Order) {
    setViewingOrderId(null);
    cart.selectTable(order.table.id);
    setTab('menu');
    push({ message: 'Выберите блюдо на замену и отправьте его на кухню', type: 'info', at: new Date().toISOString() });
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
      push({ message: 'Заказ отменён', type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function submitCart() {
    if (!selectedTable) return;
    if (!activeShift) {
      push({ message: 'Сначала начните смену в профиле.', type: 'error', at: new Date().toISOString() });
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
        setAddItemsIdemKey(crypto.randomUUID());
        push({ message: 'Заказ отправлен на кухню', type: 'success', at: new Date().toISOString() });
        setTab('cart');
      } else {
        await create.mutateAsync({
          tableId: selectedTable.id,
          comment: cart.comment,
          idempotencyKey: idemKey,
          lines: cart.lines,
        });
        cart.clear();
        setIdemKey(crypto.randomUUID());
        push({ message: 'Заказ отправлен на кухню', type: 'success', at: new Date().toISOString() });
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
      push({ message: 'Стол успешно закрыт', type: 'success', at: new Date().toISOString() });
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
      push({ message: `Заказ перенесён на стол №${updated.table.number}`, type: 'success', at: new Date().toISOString() });
      setTableModal(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function doTransferTable(waiter: AvailableWaiter) {
    if (!selectedTable) return;
    try {
      await transferTable.mutateAsync({ tableId: selectedTable.id, waiterId: waiter.id });
      push({ message: `Стол передан официанту ${waiter.name}`, type: 'success', at: new Date().toISOString() });
      setTableModal(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  // --- Панели ---
  const tablesPanel = (
    <Panel
      title="Выбор стола"
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

  const menuPanel = (
    <Panel title="Меню" action={selectedTable ? <TableChip number={selectedTable.number} /> : null}>
      <DishMenu
        categories={categoriesQ.data ?? []}
        dishes={dishesQ.data ?? []}
        onAdd={addDishToCart}
        disabled={!selectedTable}
      />
    </Panel>
  );

  const rightPanel = (
    <Panel title={null}>
      {!selectedTable ? (
        <EmptyHint text="Выберите стол, чтобы открыть заказ" />
      ) : displayedOrder && !showCart ? (
        <OrderPanel
          order={displayedOrder}
          submitting={actionPending}
          onPickedUp={() => runAction(() => pickedUp.mutateAsync(displayedOrder.id))}
          onServed={() => runAction(() => served.mutateAsync(displayedOrder.id))}
          onToPayment={() => goToPayment(displayedOrder)}
          onContinueAfterRejection={() => continueAfterPartialRejection(displayedOrder)}
          onAddReplacement={() => addReplacement(displayedOrder)}
          onCancelOrder={() => cancelAfterPartialRejection(displayedOrder)}
        />
      ) : (
        <CartPanel
          table={selectedTable}
          mode={activeOrder ? 'add' : 'create'}
          orderNumber={activeOrder?.orderNumber}
          submitting={create.isPending || addItems.isPending}
          canSubmit={!!activeShift}
          onSubmit={submitCart}
          onBlockedSubmit={() =>
            push({ message: 'Сначала начните смену в профиле.', type: 'error', at: new Date().toISOString() })
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
          push({ message: 'Смена начата', type: 'success', at: new Date().toISOString() });
        })
      }
      onEndShift={() =>
        runAction(async () => {
          await endShift.mutateAsync();
          push({ message: 'Смена завершена', type: 'success', at: new Date().toISOString() });
        })
      }
      pushStatus={pushNotifications.status}
      onEnablePush={pushNotifications.enable}
    />
  );

  const desktopView: DesktopTab = activeNavTab === 'orders' || activeNavTab === 'profile' ? activeNavTab : 'tables';

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <OfflineBanner />

      {/* Шапка */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <BrandLogo />
        </div>
        <DesktopNav current={desktopView} onChange={(next) => changeTab(next)} />
        <div className="flex items-center gap-3">
          <ConnectionStatus />
          <span className={`text-xs ${activeShift ? 'text-success' : 'text-text-muted'}`}>
            <span className="hidden sm:inline">{activeShift ? 'Смена активна' : 'Смена не начата'}</span>
            <span className="sm:hidden">{activeShift ? 'Смена активна' : 'Нет смены'}</span>
          </span>
          <span className="hidden text-sm text-text-secondary sm:inline">{user?.name}</span>
        </div>
      </header>

      {/* DESKTOP: 3 колонки */}
      <main className="hidden flex-1 gap-4 overflow-hidden p-4 lg:flex">
        {desktopView === 'tables' ? (
          <>
            <div className="w-[360px] shrink-0">{tablesPanel}</div>
            <div className="flex-1">{menuPanel}</div>
            <div className="w-[380px] shrink-0">{rightPanel}</div>
          </>
        ) : desktopView === 'orders' ? (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden">
            {viewingOrder ? (
              <div className="mx-auto h-full w-full max-w-xl">{rightPanel}</div>
            ) : (
              <>
                <h2 className="mb-3 shrink-0 text-lg font-semibold text-text-primary">Активные заказы</h2>
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
                  <OrdersList
                    orders={orders}
                    onOpen={openExistingOrder}
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="no-scrollbar mx-auto h-full w-full max-w-xl overflow-y-auto py-2">
            {profilePanel}
          </div>
        )}
      </main>

      {/* MOBILE: одна панель + нижняя навигация */}
      <main className="flex-1 overflow-hidden bg-white px-1 py-2 lg:hidden">
        {tab === 'tables' && tablesPanel}
        {tab === 'menu' && menuPanel}
        {tab === 'cart' && rightPanel}
        {tab === 'orders' && (
          <Panel title="Активные заказы">
            <div className="no-scrollbar overflow-y-auto">
              <OrdersList
                orders={orders}
                onOpen={openExistingOrder}
              />
            </div>
          </Panel>
        )}
        {tab === 'profile' && (
          <Panel title="Профиль">
            <div className="no-scrollbar overflow-y-auto">
              {profilePanel}
            </div>
          </Panel>
        )}
      </main>

      <BottomNav
        tab={activeNavTab}
        setTab={changeTab}
        cartCount={cart.lines.length}
        ordersCount={ordersAttentionCount}
      />

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
          excludeWaiterId={displayedOrder?.waiter.id ?? user?.id ?? null}
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

function DesktopNav({
  current,
  onChange,
}: {
  current: DesktopTab;
  onChange: (tab: DesktopTab) => void;
}) {
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
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

const NAV: { key: Tab; label: string; icon: JSX.Element }[] = [
  { key: 'tables', label: 'Столы', icon: <IconGrid /> },
  { key: 'menu', label: 'Меню', icon: <IconMenu /> },
  { key: 'cart', label: 'Корзина', icon: <IconCart /> },
  { key: 'orders', label: 'Заказы', icon: <IconList /> },
  { key: 'profile', label: 'Профиль', icon: <IconUser /> },
];

function BottomNav({
  tab,
  setTab,
  cartCount,
  ordersCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  cartCount: number;
  ordersCount: number;
}) {
  return (
    <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      {NAV.map((n) => {
        const active = tab === n.key;
        const badge = n.key === 'cart' ? cartCount : n.key === 'orders' ? ordersCount : 0;
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
            {n.label}
          </button>
        );
      })}
    </nav>
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
