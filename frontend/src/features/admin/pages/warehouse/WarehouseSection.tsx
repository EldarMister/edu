import { useState } from 'react';
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
import { ReportPeriodFilter, REPORT_PERIODS } from './ReportPeriodFilter';
import { calendarDate, warehouseDay, warehousePeriodRange } from './warehouse-period';
import { PreparationModal, ProductionBatchModal } from './PreparationTab';
import { StartDocumentModal } from './StockDocumentsTab';
import { StockDocumentModal } from './StockDocumentModal';
import { DocumentList, ProductionList } from './WarehouseDocumentLists';
import { SupplyList } from './WarehouseSupplies';
import { ProcessingPage, ProcessingModal } from './ProcessingPage';
import { LocationsPage, SuppliersPage, PackagesPage } from './WarehouseDirectories';
import { QueryState } from './WarehouseUi';
import { WAREHOUSE_NAV, warehouseViewAllowed, warehouseViewInUse, type WarehouseView, type MenuView } from './navigation';
import { useAdminOrderDetails } from '../../api';
import { OrderDetailsModal } from '../../components/OrderDetailsModal';
import { ItemCard } from './ItemCard';
import { useWarehouseLocations, useIngredients, type Ingredient } from './api';
import { useWarehousePolicy } from './settings-api';

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
    stockPeriod: 'week',
    stockFrom: '',
    stockTo: '',
    movementPage: '1',
    movementRange: '',
    movementExpanded: '',
    movementDocuments: '',
    movementClosedGroups: '',
    movementWarehouses: '',
    supplyPage: '1', supplyExpanded: '', transferPage: '1', writeoffPage: '1', inventoryPage: '1',
  });
  const {
    warehouse: warehouseId,
    stockPeriod: presetValue,
    stockFrom,
    stockTo,
  } = conditions;
  const today = warehouseDay();
  const customFrom = stockFrom || calendarDate(today, -6);
  const customTo = stockTo || calendarDate(today);
  function setReportConditions(
    patch: Partial<Pick<typeof conditions, 'warehouse' | 'stockPeriod' | 'stockFrom' | 'stockTo'>>,
  ) {
    updateConditions({ ...patch, movementPage: '1', movementRange: '', movementExpanded: '', movementDocuments: '', movementClosedGroups: '',
      ...(patch.warehouse !== undefined ? { supplyPage: '1', supplyExpanded: '', transferPage: '1', writeoffPage: '1', inventoryPage: '1' } : {}),
    });
  }
  const setWarehouseId = (value: string) => setReportConditions({ warehouse: value });
  const { editor: active, openEditor: setActive, closeEditor: close } = useEditorRoute();
  const [stockFilter, setStockFilter] = usePageFilter('stockFilter');
  const policy = useWarehousePolicy();
  const permissions = usePermissions();
  const locationsQ = useWarehouseLocations();
  const locations = locationsQ.data?.locations ?? [];
  const warehouse =
    locations.find((l) => l.id === warehouseId) ?? locations.find((l) => l.isDefault) ?? locations[0];
  const preset = presetValue === 'custom' ? 'custom' : REPORT_PERIODS.find(({ value }) => value === presetValue)?.value ?? 'week';
  const range = warehousePeriodRange(preset, today, customFrom, customTo);
  const periodFilter = <ReportPeriodFilter preset={preset} today={today} range={range}
    onPreset={(value) => setReportConditions({ stockPeriod: value, stockFrom: '', stockTo: '' })}
    onRange={(from, to) => setReportConditions({ stockPeriod: 'custom', stockFrom: from, stockTo: to })} />;
  const allowedViews = WAREHOUSE_NAV.filter(
    (v) =>
      (!staffMode || ['balances', 'processing', 'production', 'locations'].includes(v.key)) &&
      warehouseViewInUse(v.key, locations.length, policy.data) &&
      warehouseViewAllowed(v, permissions),
  );
  const allowed = allowedViews.some((v) => v.key === view);
  const aggregate = ['balances', 'movement', 'supplies', 'processing', 'transfers', 'writeoffs', 'inventory'].includes(view);
  const scopedWarehouse = aggregate ? warehouseId || undefined : warehouse?.id;
  const movementWarehouseSelection = conditions.movementWarehouses
    ? conditions.movementWarehouses.split(',')
    : warehouseId ? [warehouseId] : [];
  const movementLocations = locations
    .filter(({ id }) => movementWarehouseSelection.includes(id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const movementHistory = view === 'movement' && active?.type === 'history';
  const historyWarehouseIds = movementHistory && movementLocations.length > 1
    ? movementLocations.map(({ id }) => id).join(',')
    : undefined;
  const historyWarehouseId = movementHistory
    ? (movementLocations.length === 1 ? movementLocations[0].id : undefined)
    : active?.warehouseId;
  const warehouseFilter = <Select ariaLabel="Склад" className="poster-filter h-9 min-w-44"
    value={aggregate ? warehouseId : (warehouse?.id ?? '')} onChange={setWarehouseId}
    options={[...(aggregate ? [{ value: '', label: view === 'balances' || view === 'movement' ? 'Склад' : 'Все склады' }] : []), ...locations.map((location) => ({ value: location.id, label: location.name }))]} />;
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
                      warehouseName={warehouseId ? warehouse.name : undefined}
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
                      onOpen={(id, edit) => setActive({ type: 'purchase', id, action: edit ? 'correct' : undefined })}
                      onCreate={() => setActive({ type: 'purchase' })}
                    />
                  )}
                  {view === 'processing' && (
                    <ProcessingPage
                      filters={warehouseFilter}
                      warehouseId={scopedWarehouse}
                      onOpen={(id) => setActive({ type: 'processing', id })}
                      onCreate={() => setActive({ type: 'processing' })}
                      onCopy={(id) => setActive({ type: 'processing', id, action: 'copy' })}
                    />
                  )}
                  {['transfers', 'writeoffs', 'inventory'].includes(view) && (
                    <DocumentList
                      filters={view === 'transfers' ? undefined : warehouseFilter}
                      kind={
                        view === 'transfers' ? 'transfer' : view === 'writeoffs' ? 'writeoff' : 'inventory'
                      }
                      warehouseId={scopedWarehouse}
                      locations={locations}
                      onOpen={(id) => setActive({ type: 'document', id })}
                      onCopy={view === 'transfers' ? (id) => setActive({ type: 'start', action: 'transfer', id }) : undefined}
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
                      locations={locations}
                      periodFilter={periodFilter}
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
        {active?.type === 'supplier' && <SuppliersPage />}
        {active?.type === 'location' && locationsQ.data && <LocationsPage data={locationsQ.data} />}
        {active?.type === 'package' && <PackagesPage />}
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
            <QueryState
              pending={movementHistory && locationsQ.isPending}
              error={movementHistory ? locationsQ.error : undefined}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {movementHistory && (
                    <p className="text-sm text-text-muted">
                      {movementLocations.length
                        ? `Склады: ${movementLocations.map(({ name }) => name).join(', ')}`
                        : 'Все склады'}
                    </p>
                  )}
                  {periodFilter}
                </div>
                <WarehouseReportsTab
                  key={`${historyWarehouseIds ?? historyWarehouseId ?? ''}:${range.dateFrom ?? ''}:${range.dateTo ?? ''}`}
                  warehouseId={historyWarehouseId}
                  warehouseIds={historyWarehouseIds}
                  range={range}
                  view="movements"
                  onView={() => {}}
                  contextOnly
                  ingredientId={active.itemId}
                  onOpen={openSource}
                />
              </div>
            </QueryState>
          </EditorPage>
        )}
        {warehouse && (
          <>
            {active?.type === 'purchase' && (
              <PurchaseModal
                key={`${active.id ?? 'new'}:${active.action ?? ''}`}
                id={active.id}
                edit={active.action === 'correct'}
                warehouseId={warehouse.id}
                locations={locations}
                onClose={close}
                onReturn={(id, warehouseId) =>
                  setActive({ type: 'start', action: 'supplier_return', id, warehouseId })
                }
                onOpenDocument={(id) => setActive({ type: 'document', id })}
              />
            )}
            {active?.type === 'processing' && (
              <ProcessingModal
                id={active.action === 'copy' ? undefined : active.id}
                copyFromId={active.action === 'copy' ? active.id : undefined}
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
                sourcePurchaseId={active.action === 'supplier_return' ? active.id : undefined}
                copyTransferId={active.action === 'transfer' ? active.id : undefined}
                onCreated={(id) => setActive({ type: 'document', id }, true)}
              />
            )}
            {active?.type === 'document' && active.id && (
              <StockDocumentModal
                id={active.id}
                warehouse={warehouse}
                isOwner={permissions.can('actions.warehouseApprove')}
                onClose={close}
                onCopyTransfer={(id) => setActive({ type: 'start', action: 'transfer', id })}
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
