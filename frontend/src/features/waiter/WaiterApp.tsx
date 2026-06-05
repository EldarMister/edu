import { useMemo, useState } from 'react';
import type { Order } from '@/types';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
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
  useStartShift,
  useEndShift,
} from './api';
import { TablesGrid } from './TablesGrid';
import { DishMenu } from './DishMenu';
import { CartPanel } from './CartPanel';
import { OrderPanel } from './OrderPanel';
import { OrdersList } from './OrdersList';
import { WaiterProfile } from './WaiterProfile';
import { PaymentModal } from './PaymentModal';

type Tab = 'tables' | 'menu' | 'cart' | 'orders' | 'profile';
type DesktopTab = 'tables' | 'orders' | 'profile';

export function WaiterApp() {
  useWaiterRealtime();
  const user = useAuth((s) => s.user);
  const push = useNotifications((s) => s.push);

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
  const startShift = useStartShift();
  const endShift = useEndShift();

  const [tab, setTab] = useState<Tab>('tables');
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

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
  const showCart = cart.lines.length > 0 || !activeOrder;

  const actionPending =
    pickedUp.isPending || served.isPending || toPayment.isPending;
  const shiftPending = startShift.isPending || endShift.isPending;

  if (hallsQ.isLoading || categoriesQ.isLoading || dishesQ.isLoading || currentShiftQ.isLoading) {
    return <FullScreenLoader />;
  }

  function selectTable(tableId: string) {
    cart.selectTable(tableId);
    setTab(ordersByTable.has(tableId) ? 'cart' : 'menu');
  }

  async function submitCart() {
    if (!selectedTable) return;
    if (!activeShift) {
      push({ message: 'Сначала начните смену в профиле.', at: new Date().toISOString() });
      return;
    }
    try {
      if (activeOrder) {
        await addItems.mutateAsync({ orderId: activeOrder.id, lines: cart.lines });
        cart.clear();
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
        setTab('orders');
      }
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  async function runAction(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  // --- Панели ---
  const tablesPanel = (
    <Panel title="Выбор стола">
      <TablesGrid halls={halls} selectedTableId={cart.tableId} onSelect={selectTable} />
    </Panel>
  );

  const menuPanel = (
    <Panel title="Меню">
      {!selectedTable ? (
        <EmptyHint text="Сначала выберите стол" />
      ) : (
        <DishMenu
          categories={categoriesQ.data ?? []}
          dishes={dishesQ.data ?? []}
          onAdd={cart.add}
        />
      )}
    </Panel>
  );

  const rightPanel = (
    <Panel title={null}>
      {!selectedTable ? (
        <EmptyHint text="Выберите стол, чтобы открыть заказ" />
      ) : activeOrder && !showCart ? (
        <OrderPanel
          order={activeOrder}
          submitting={actionPending}
          onPickedUp={() => runAction(() => pickedUp.mutateAsync(activeOrder.id))}
          onServed={() => runAction(() => served.mutateAsync(activeOrder.id))}
          onToPayment={() => runAction(() => toPayment.mutateAsync(activeOrder.id))}
          onPay={() => setPaymentOrder(activeOrder)}
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
            push({ message: 'Сначала начните смену в профиле.', at: new Date().toISOString() })
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
      onStartShift={() => runAction(() => startShift.mutateAsync())}
      onEndShift={() => runAction(() => endShift.mutateAsync())}
    />
  );

  const desktopView: DesktopTab = tab === 'orders' || tab === 'profile' ? tab : 'tables';

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <OfflineBanner />

      {/* Шапка */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-text-primary">
            Вкусно <span className="text-primary">•</span> POS
          </span>
          <span className="hidden text-sm text-text-muted sm:inline">· Кафе «Вкусно»</span>
        </div>
        <DesktopNav current={desktopView} onChange={(next) => setTab(next)} />
        <div className="flex items-center gap-4">
          <ConnectionStatus />
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
            <h2 className="mb-3 shrink-0 text-lg font-semibold text-text-primary">Активные заказы</h2>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <OrdersList
                orders={orders}
                onOpen={(o) => {
                  cart.selectTable(o.table.id);
                  setTab('cart');
                }}
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto h-full w-full max-w-xl overflow-y-auto py-2">
            {profilePanel}
          </div>
        )}
      </main>

      {/* MOBILE: одна панель + нижняя навигация */}
      <main className="flex-1 overflow-hidden p-3 lg:hidden">
        {tab === 'tables' && tablesPanel}
        {tab === 'menu' && menuPanel}
        {tab === 'cart' && rightPanel}
        {tab === 'orders' && (
          <Panel title="Активные заказы">
            <div className="overflow-y-auto">
              <OrdersList
                orders={orders}
                onOpen={(o) => {
                  cart.selectTable(o.table.id);
                  setTab('cart');
                }}
              />
            </div>
          </Panel>
        )}
        {tab === 'profile' && (
          <Panel title="Профиль">
            <div className="overflow-y-auto">
              {profilePanel}
            </div>
          </Panel>
        )}
      </main>

      <BottomNav tab={tab} setTab={setTab} cartCount={cart.lines.length} ordersCount={orders.length} />

      {paymentOrder && (
        <PaymentModal
          order={paymentOrder}
          open={!!paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onPaid={() => {
            setPaymentOrder(null);
            setTab('tables');
          }}
        />
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string | null; children: React.ReactNode }) {
  return (
    <section className="card flex h-full flex-col p-4">
      {title && <h2 className="mb-3 shrink-0 text-lg font-semibold text-text-primary">{title}</h2>}
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
