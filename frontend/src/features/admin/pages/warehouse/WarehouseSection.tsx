import { useMemo, useState } from 'react';
import { DatePicker } from '@/components/DatePicker';
import { EditorPage } from './EditorPage';
import { useEditorRoute, usePageFilter, usePageFilters } from './workspace-route';
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
import { SupplyList, DocumentList, ProductionList } from './WarehouseDocumentLists';
import { ProcessingPage, ProcessingModal } from './ProcessingPage';
import { LocationsPage, SuppliersPage, PackagesPage } from './WarehouseDirectories';
import { QueryState } from './WarehouseUi';
import { WAREHOUSE_NAV, warehouseViewInUse, type WarehouseView, type MenuView } from './navigation';
import { useAdminOrderDetails } from '../../api';
import { OrderDetailsModal } from '../../components/OrderDetailsModal';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { ItemCard } from './ItemCard';
import { useWarehouseLocations, useIngredients, type Ingredient } from './api';
import { useWarehousePolicy } from './settings-api';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';
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
  const [conditions, updateConditions] = usePageFilters({
    warehouse: '',
    stockPeriod: 'today',
    stockFrom: localDate(addDays(new Date(), -6)),
    stockTo: localDate(new Date()),
    movementPage: '1',
    movementRange: '',
  });
  const {
    warehouse: warehouseId,
    stockPeriod: presetValue,
    stockFrom: customFrom,
    stockTo: customTo,
  } = conditions;
  function setReportConditions(
    patch: Partial<Pick<typeof conditions, 'warehouse' | 'stockPeriod' | 'stockFrom' | 'stockTo'>>,
  ) {
    updateConditions({ ...patch, movementPage: '1', movementRange: '' });
  }
  const setWarehouseId = (value: string) => setReportConditions({ warehouse: value });
  const setPreset = (value: PeriodPreset) => setReportConditions({ stockPeriod: value });
  const setCustomFrom = (value: string) => setReportConditions({ stockFrom: value });
  const setCustomTo = (value: string) => setReportConditions({ stockTo: value });
  const { editor: active, openEditor: setActive, closeEditor: close } = useEditorRoute();
  const [stockFilter, setStockFilter] = usePageFilter('stockFilter');
  const policy = useWarehousePolicy();
  const permissions = usePermissions();
  const locationsQ = useWarehouseLocations();
  const locations = locationsQ.data?.locations ?? [];
  const warehouse =
    locations.find((l) => l.id === warehouseId) ?? locations.find((l) => l.isDefault) ?? locations[0];
  const preset = presetValue as PeriodPreset;
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
      warehouseViewInUse(v.key, locations.length, policy.data) &&
      (!v.permission || permissions.can(`actions.${v.permission}`)) &&
      (!v.costs || permissions.can('actions.warehouseCosts')),
  );
  const allowed = allowedViews.some((v) => v.key === view);
  const aggregate = ['balances', 'movement', 'supplies', 'processing'].includes(view);
  const scopedWarehouse = aggregate ? warehouseId || undefined : warehouse?.id;
  const warehouseFilter = <Select ariaLabel="Склад" className="poster-filter h-9 min-w-44"
    value={aggregate ? warehouseId : (warehouse?.id ?? '')} onChange={setWarehouseId}
    options={[...(aggregate ? [{ value: '', label: 'Все склады' }] : []), ...locations.map((location) => ({ value: location.id, label: location.name }))]} />;
  function history(itemId?: string, sourceWarehouseId?: string) {
    setActive({ type: 'history', itemId, warehouseId: sourceWarehouseId ?? scopedWarehouse });
  }
  function openSource(type: string, id: string) {
    if (type === 'order') setActive({ type: 'order', id });
    else if (type === 'production') setActive({ type: 'batch', id });
    else if (type === 'processing') setActive({ type: 'processing', id });
    else if (type === 'purchase') setActive({ type: 'purchase', id });
    else if (['inventory', 'writeoff', 'transfer', 'supplier_return', 'document'].includes(type))
      setActive({ type: 'document', id });
  }
  return (
    <div className="space-y-4">
      {!active && (
        <>
          <>
            {staffMode && onView && (
              <Select
                ariaLabel="Раздел склада"
                className="h-10 min-w-44"
                value={view}
                onChange={(v) => onView(v as WarehouseView)}
                options={allowedViews.map((v) => ({ value: v.key, label: v.label }))}
              />
            )}
            {view === 'movement' && (
              <WorkspaceHeaderActions>
              <PeriodFilter
                preset={preset}
                setPreset={setPreset}
                customFrom={customFrom}
                customTo={customTo}
                setCustomFrom={setCustomFrom}
                setCustomTo={setCustomTo}
              />
              </WorkspaceHeaderActions>
            )}
          </>
          {!allowed ? (
            <p className="card p-8 text-center text-text-muted">Нет доступа к этому разделу.</p>
          ) : (
            <QueryState pending={locationsQ.isPending} error={locationsQ.error}>
              {warehouse && (
                <>
                  {view === 'balances' && (
                    <IngredientsTab
                      filters={warehouseFilter}
                      warehouseId={scopedWarehouse}
                      filter={stockFilter as StockFilter}
                      onFilter={setStockFilter}
                      onOpen={(item) => setActive({ type: 'item', id: item.id })}
                      onCreate={() => (onMenu ? onMenu('ingredients') : setActive({ type: 'item' }))}
                      onHistory={(id) => history(id)}
                      onProduce={(item) => setActive({ type: 'preparation', action: 'produce', id: item.id })}
                      catalogue={false}
                    />
                  )}
                  {view === 'supplies' && (
                    <SupplyList
                      filters={warehouseFilter}
                      warehouseId={scopedWarehouse}
                      onOpen={(id) => setActive({ type: 'purchase', id })}
                      onCreate={() => setActive({ type: 'purchase' })}
                    />
                  )}
                  {view === 'processing' && (
                    <ProcessingPage
                      filters={warehouseFilter}
                      warehouseId={scopedWarehouse}
                      onOpen={(id) => setActive({ type: 'processing', id })}
                      onCreate={() => setActive({ type: 'processing' })}
                    />
                  )}
                  {['transfers', 'writeoffs', 'inventory'].includes(view) && (
                    <DocumentList
                      filters={warehouseFilter}
                      kind={
                        view === 'transfers' ? 'transfer' : view === 'writeoffs' ? 'writeoff' : 'inventory'
                      }
                      warehouseId={warehouse.id}
                      locations={locations}
                      onOpen={(id) => setActive({ type: 'document', id })}
                      onCreate={() =>
                        setActive({
                          type: 'start',
                          action:
                            view === 'transfers'
                              ? 'transfer'
                              : view === 'writeoffs'
                                ? 'writeoff'
                                : 'inventory',
                        })
                      }
                    />
                  )}
                  {view === 'production' && (
                    <ProductionList
                      filters={warehouseFilter}
                      warehouseId={warehouse.id}
                      onOpen={(id) => setActive({ type: 'batch', id })}
                      onCreate={() => setActive({ type: 'chooseProduction' })}
                    />
                  )}
                  {view === 'movement' && (
                    <WarehouseMovementSummary
                      filters={warehouseFilter}
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
        </>
      )}
      <div key={`${active?.type}:${active?.id ?? 'new'}:${active?.action ?? ''}`}>
        {active && ['supplier', 'location', 'package'].includes(active.type) && !permissions.can('actions.warehouseSettings') &&
          <EditorPage title="Справочник склада" onClose={close}><p role="alert" className="text-text-muted">Нет доступа к настройкам склада.</p></EditorPage>}
        {active?.type === 'supplier' && permissions.can('actions.warehouseSettings') && <SuppliersPage />}
        {active?.type === 'location' && permissions.can('actions.warehouseSettings') && locationsQ.data && <LocationsPage data={locationsQ.data} />}
        {active?.type === 'package' && permissions.can('actions.warehouseSettings') && <PackagesPage />}
        {active?.type === 'item' && (
          <ItemCard
            id={active.id}
            onClose={close}
            onHistory={(id) => history(id)}
            onRecipe={(item) => setActive({ type: 'preparation', action: 'recipe', id: item.id })}
          />
        )}
        {active?.type === 'order' && active.id && <SourceOrder id={active.id} onClose={close} />}
        {(active?.type === 'batch' || active?.type === 'productionBatch') && active.id && (
          <ProductionBatchModal id={active.id} onClose={close} />
        )}
        {active?.type === 'history' && (
          <EditorPage open onClose={close} title="Движение товара" panelClassName="max-w-6xl">
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
                view="movements"
                onView={() => {}}
                contextOnly
                ingredientId={active.itemId}
                onOpen={openSource}
              />
            </div>
          </EditorPage>
        )}
        {warehouse && (
          <>
            {active?.type === 'purchase' && (
              <PurchaseModal
                id={active.id}
                warehouseId={warehouse.id}
                locations={locations}
                onClose={close}
                onReturn={(id, warehouseId) =>
                  setActive({ type: 'start', action: 'supplier_return', id, warehouseId })
                }
              />
            )}
            {active?.type === 'processing' && (
              <ProcessingModal
                id={active.id}
                warehouseId={warehouse.id}
                locations={locations}
                onClose={close}
              />
            )}
            {active?.type === 'start' && (
              <StartDocumentModal
                kind={active.action as StockDocumentKind}
                warehouseId={active.warehouseId ?? warehouse.id}
                locations={locations}
                onClose={close}
                sourcePurchaseId={active.id}
                onCreated={(id) => setActive({ type: 'document', id }, true)}
              />
            )}
            {active?.type === 'document' && active.id && (
              <StockDocumentModal
                id={active.id}
                warehouse={warehouse}
                isOwner={permissions.can('actions.warehouseApprove')}
                onClose={close}
              />
            )}
            {active?.type === 'preparation' && active.id && (
              <PreparationModal
                action={{
                  kind: active.action === 'recipe' ? 'recipe' : 'produce',
                  id: active.id,
                  name: 'Заготовка',
                }}
                onBatch={(id) => setActive({ type: 'batch', id })}
                warehouse={warehouse}
                onClose={close}
              />
            )}
            {active?.type === 'chooseProduction' && (
              <ChooseProduction
                warehouseId={warehouse.id}
                onClose={close}
                onSelect={(item) => setActive({ type: 'preparation', action: 'produce', id: item.id })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
function SourceOrder({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdminOrderDetails(id);
  if (query.data) return <OrderDetailsModal order={query.data} onClose={onClose} presentation="page" />;
  return (
    <EditorPage open title="Заказ" onClose={onClose}>
      {query.isError ? (
        <p role="alert" className="text-danger">
          {apiError(query.error)}
        </p>
      ) : (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}
    </EditorPage>
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
    <EditorPage open title="Приготовить заготовку" onClose={onClose}>
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
    </EditorPage>
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
