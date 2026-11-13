import { useMemo, useState } from 'react';
import { DatePicker } from '@/components/DatePicker';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { IngredientsTab, type StockFilter } from './IngredientsTab';
import { PurchaseModal } from './PurchasesTab';
import type { StockDocumentKind } from './stock-documents-api';
import { WarehouseReportsTab } from './WarehouseReportsTab';
import { WarehouseMovementSummary } from './WarehouseMovementSummary';
import { PreparationModal, ProductionBatchModal } from './PreparationTab';
import { StartDocumentModal } from './StockDocumentsTab';
import { StockDocumentModal } from './StockDocumentModal';
import { AccountingSettings } from './WarehouseSettingsPanels';
import { SupplyList, DocumentList, ProductionList } from './WarehouseDocumentLists';
import { ProcessingPage, ProcessingModal } from './ProcessingPage';
import { LocationsPage, SuppliersPage, PackagesPage } from './WarehouseDirectories';
import { QueryState } from './WarehouseUi';
import { WAREHOUSE_NAV, type WarehouseView, type MenuView } from './navigation';
import { useAdminOrderDetails } from '../../api';
import { OrderDetailsModal } from '../../components/OrderDetailsModal';
import { ItemCard } from './ItemCard';
import { useWarehouseLocations, useIngredients, type Ingredient } from './api';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';
type Active =
  | { kind: 'item'; id?: string }
  | { kind: 'purchase'; id?: string }
  | { kind: 'processing'; id?: string }
  | { kind: 'start'; action: StockDocumentKind }
  | { kind: 'document'; id: string }
  | { kind: 'preparation'; action: 'recipe' | 'produce'; item: Ingredient }
  | { kind: 'chooseProduction' }
  | { kind: 'batch'; id: string }
  | { kind: 'order'; id: string }
  | { kind: 'history'; itemId?: string; warehouseId?: string }
  | null;

export function WarehouseSection({
  view = 'balances',
  onView,
  onMenu,
  staffMode = false,
}: {
  view?: WarehouseView;
  onView?: (v: WarehouseView) => void;
  onMenu?: (v: MenuView) => void;
  staffMode?: boolean;
} = {}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [settings, setSettings] = useState(false);
  const [active, setActive] = useState<Active>(null);
  const [stockFilter, setStockFilter] = useState<StockFilter>('');
  const [report, setReport] = useState('movements');
  const permissions = usePermissions();
  const locationsQ = useWarehouseLocations();
  const locations = locationsQ.data?.locations ?? [];
  const warehouse =
    locations.find((l) => l.id === warehouseId) ?? locations.find((l) => l.isDefault) ?? locations[0];
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const [customFrom, setCustomFrom] = useState(localDate(addDays(new Date(), -6)));
  const [customTo, setCustomTo] = useState(localDate(new Date()));
  const range = useMemo(
    () => ({
      dateFrom:
        preset === 'custom'
          ? customFrom
          : localDate(addDays(new Date(), preset === 'today' ? 0 : preset === 'month' ? -29 : -6)),
      dateTo: preset === 'custom' ? customTo : localDate(new Date()),
    }),
    [preset, customFrom, customTo],
  );
  const allowedViews = WAREHOUSE_NAV.filter(
    (v) =>
      (!v.permission || permissions.can(`actions.${v.permission}`)) &&
      (!v.costs || permissions.can('actions.warehouseCosts')),
  );
  const allowed = allowedViews.some((v) => v.key === view);
  const aggregate = ['balances', 'movement', 'supplies', 'processing'].includes(view);
  const scopedWarehouse = aggregate ? warehouseId || undefined : warehouse?.id;
  const close = () => setActive(null);
  function history(itemId?: string, sourceWarehouseId?: string) {
    setReport('movements');
    setActive({ kind: 'history', itemId, warehouseId: sourceWarehouseId ?? scopedWarehouse });
  }
  function openSource(type: string, id: string) {
    if (type === 'order') setActive({ kind: 'order', id });
    else if (type === 'production') setActive({ kind: 'batch', id });
    else if (type === 'processing') setActive({ kind: 'processing', id });
    else if (type === 'purchase') setActive({ kind: 'purchase', id });
    else if (['inventory', 'writeoff', 'transfer', 'supplier_return', 'document'].includes(type))
      setActive({ kind: 'document', id });
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {staffMode && onView && (
          <Select
            ariaLabel="Раздел склада"
            className="h-10 min-w-44"
            value={view}
            onChange={(v) => onView(v as WarehouseView)}
            options={allowedViews.map((v) => ({ value: v.key, label: v.label }))}
          />
        )}
        {!['suppliers', 'locations', 'packages'].includes(view) && (
          <Select
            ariaLabel="Склад"
            className="h-10 min-w-44"
            value={aggregate ? warehouseId : (warehouse?.id ?? '')}
            onChange={setWarehouseId}
            options={[
              ...(aggregate ? [{ value: '', label: 'Все склады' }] : []),
              ...locations.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        )}
        {view === 'movement' && (
          <PeriodFilter
            preset={preset}
            setPreset={setPreset}
            customFrom={customFrom}
            customTo={customTo}
            setCustomFrom={setCustomFrom}
            setCustomTo={setCustomTo}
          />
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {view === 'movement' && (
            <button className="btn-secondary btn-md" onClick={() => history()}>
              Журнал и другие отчёты
            </button>
          )}
          {permissions.can('actions.warehouseSettings') && (
            <button className="btn-ghost btn-md" onClick={() => setSettings(true)}>
              Настройки учёта
            </button>
          )}
        </div>
      </div>
      {!allowed ? (
        <p className="card p-8 text-center text-text-muted">Нет доступа к этому разделу.</p>
      ) : (
        <QueryState pending={locationsQ.isPending} error={locationsQ.error}>
          {warehouse && (
            <>
              {view === 'balances' && (
                <IngredientsTab
                  warehouseId={scopedWarehouse}
                  filter={stockFilter}
                  onFilter={setStockFilter}
                  onOpen={(item) => setActive({ kind: 'item', id: item.id })}
                  onCreate={() => (onMenu ? onMenu('ingredients') : setActive({ kind: 'item' }))}
                  onHistory={(id) => history(id)}
                  onProduce={(item) => setActive({ kind: 'preparation', action: 'produce', item })}
                  catalogue={false}
                />
              )}
              {view === 'supplies' && (
                <SupplyList
                  warehouseId={scopedWarehouse}
                  onOpen={(id) => setActive({ kind: 'purchase', id })}
                  onCreate={() => setActive({ kind: 'purchase' })}
                  onReturn={() => setActive({ kind: 'start', action: 'supplier_return' })}
                />
              )}
              {view === 'processing' && (
                <ProcessingPage
                  warehouseId={scopedWarehouse}
                  onOpen={(id) => setActive({ kind: 'processing', id })}
                  onCreate={() => setActive({ kind: 'processing' })}
                />
              )}
              {['transfers', 'writeoffs', 'inventory'].includes(view) && (
                <DocumentList
                  kind={view === 'transfers' ? 'transfer' : view === 'writeoffs' ? 'writeoff' : 'inventory'}
                  warehouseId={warehouse.id}
                  locations={locations}
                  onOpen={(id) => setActive({ kind: 'document', id })}
                  onCreate={() =>
                    setActive({
                      kind: 'start',
                      action:
                        view === 'transfers' ? 'transfer' : view === 'writeoffs' ? 'writeoff' : 'inventory',
                    })
                  }
                />
              )}
              {view === 'production' && (
                <ProductionList
                  warehouseId={warehouse.id}
                  onOpen={(id) => setActive({ kind: 'batch', id })}
                  onCreate={() => setActive({ kind: 'chooseProduction' })}
                />
              )}
              {view === 'movement' && (
                <WarehouseMovementSummary
                  warehouseId={scopedWarehouse}
                  range={range}
                  onOpen={openSource}
                  onHistory={history}
                />
              )}
              {view === 'suppliers' && <SuppliersPage />}
              {view === 'locations' && locationsQ.data && <LocationsPage data={locationsQ.data} />}
              {view === 'packages' && <PackagesPage />}
            </>
          )}
        </QueryState>
      )}
      {active?.kind === 'item' && (
        <ItemCard
          id={active.id}
          onClose={close}
          onHistory={(id) => history(id)}
          onRecipe={(item) => setActive({ kind: 'preparation', action: 'recipe', item })}
        />
      )}
      {active?.kind === 'order' && <SourceOrder id={active.id} onClose={close} />}
      {active?.kind === 'batch' && <ProductionBatchModal id={active.id} onClose={close} />}
      {active?.kind === 'history' && (
        <Modal open onClose={close} title="Движение товара и отчёты" panelClassName="max-w-6xl">
          <div className="space-y-3">
            <PeriodFilter
              preset={preset}
              setPreset={setPreset}
              customFrom={customFrom}
              customTo={customTo}
              setCustomFrom={setCustomFrom}
              setCustomTo={setCustomTo}
            />
            <WarehouseReportsTab
              warehouseId={active.warehouseId}
              range={range}
              view={report}
              onView={setReport}
              ingredientId={active.itemId}
              onOpen={openSource}
            />
          </div>
        </Modal>
      )}
      {warehouse && (
        <>
          {active?.kind === 'purchase' && (
            <PurchaseModal id={active.id} warehouseId={warehouse.id} locations={locations} onClose={close} />
          )}
          {active?.kind === 'processing' && (
            <ProcessingModal
              id={active.id}
              warehouseId={warehouse.id}
              locations={locations}
              onClose={close}
            />
          )}
          {active?.kind === 'start' && (
            <StartDocumentModal
              kind={active.action}
              warehouseId={warehouse.id}
              locations={locations}
              onClose={close}
              onCreated={(id) => setActive({ kind: 'document', id })}
            />
          )}
          {active?.kind === 'document' && (
            <StockDocumentModal
              id={active.id}
              warehouse={warehouse}
              isOwner={permissions.can('actions.warehouseApprove')}
              onClose={close}
            />
          )}
          {active?.kind === 'preparation' && (
            <PreparationModal
              action={{ kind: active.action, id: active.item.id, name: active.item.name }}
              warehouse={warehouse}
              onClose={close}
            />
          )}
          {active?.kind === 'chooseProduction' && (
            <ChooseProduction
              warehouseId={warehouse.id}
              onClose={close}
              onSelect={(item) => setActive({ kind: 'preparation', action: 'produce', item })}
            />
          )}
        </>
      )}
      {settings && (
        <Modal open title="Настройки учёта" panelClassName="max-w-2xl" onClose={() => setSettings(false)}>
          <AccountingSettings />
        </Modal>
      )}
    </div>
  );
}
function SourceOrder({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdminOrderDetails(id);
  if (query.data) return <OrderDetailsModal order={query.data} onClose={onClose} />;
  return (
    <Modal open title="Заказ" onClose={onClose}>
      {query.isError ? (
        <p role="alert" className="text-danger">
          {apiError(query.error)}
        </p>
      ) : (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}
    </Modal>
  );
}
function ChooseProduction({
  warehouseId,
  onClose,
  onSelect,
}: {
  warehouseId: string;
  onClose: () => void;
  onSelect: (item: Ingredient) => void;
}) {
  const [search, setSearch] = useState('');
  const query = useIngredients(search, warehouseId);
  const rows = (query.data ?? []).filter((i) => i.isPrepared && i.preparationMode !== 'virtual');
  return (
    <Modal open title="Приготовить заготовку" onClose={onClose}>
      <div className="space-y-3">
        <input
          className="input w-full"
          aria-label="Поиск заготовки"
          placeholder="Название заготовки"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {query.isPending && <Spinner />}
        {query.isError && (
          <p role="alert" className="text-danger">
            {apiError(query.error)}
          </p>
        )}
        {rows.map((i) => (
          <button
            type="button"
            key={i.id}
            className="btn-secondary btn-md w-full justify-start"
            onClick={() => onSelect(i)}
          >
            {i.name}
          </button>
        ))}
        {query.isSuccess && !rows.length && (
          <p className="text-sm text-text-muted">
            Добавьте товар с типом «Полуфабрикат», выберите учёт партиями и заполните рецептуру.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function PeriodFilter({
  preset,
  setPreset,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
}: {
  preset: PeriodPreset;
  setPreset: (v: PeriodPreset) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
}) {
  const items: { key: PeriodPreset; label: string }[] = [
    { key: 'today', label: 'Сегодня' },
    { key: 'week', label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
    { key: 'custom', label: 'Период' },
  ];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="inline-flex rounded-lg border border-border bg-white p-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              preset === item.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
            }`}
            onClick={() => setPreset(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <DatePicker
            className="input h-10 w-[145px] text-sm"
            value={customFrom}
            onChange={(value) => setCustomFrom(value)}
          />
          <span className="text-text-muted">-</span>
          <DatePicker
            className="input h-10 w-[145px] text-sm"
            value={customTo}
            onChange={(value) => setCustomTo(value)}
          />
        </div>
      )}
    </div>
  );
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
