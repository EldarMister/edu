import { DatePicker } from '@/components/DatePicker';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useMemo, useState } from 'react';
import { WarehousePage } from '../WarehousePage';
import { IngredientsTab } from './IngredientsTab';
import { PurchasesTab } from './PurchasesTab';
import { MovementsTab } from './MovementsTab';
import { WarehouseOverviewTab } from './WarehouseOverviewTab';
import { PreparationTab } from './PreparationTab';
import { StockDocumentsTab } from './StockDocumentsTab';
import { WarehouseLocationsModal } from './WarehouseLocationsModal';
import { useWarehouseLocations } from './api';

type Tab = 'overview' | 'dishes' | 'ingredients' | 'preparation' | 'purchases' | 'inventory' | 'writeoff' | 'movements';
type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'dishes', label: 'Блюда' },
  { key: 'ingredients', label: 'Сырьё' },
  { key: 'preparation', label: 'Полуфабрикаты' },
  { key: 'purchases', label: 'Закупки' },
  { key: 'inventory', label: 'Инвентаризация' },
  { key: 'writeoff', label: 'Списания' },
  { key: 'movements', label: 'Движения' },
];

/** Раздел «Склад»: верхние табы Блюда / Сырьё / Закупки / Движения. */
export function WarehouseSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [warehouseId, setWarehouseId] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const { isOwner } = usePermissions();
  const locationsQuery = useWarehouseLocations();
  const locations = locationsQuery.data?.locations ?? [];
  const defaultWarehouse = locations.find((location) => location.isDefault);
  const selectedWarehouse = locations.find((location) => location.id === warehouseId);
  const stockWarehouse = selectedWarehouse ?? defaultWarehouse;
  const needsWarehouse = tab === 'ingredients' || tab === 'preparation' || tab === 'inventory' || tab === 'writeoff';
  const [preset, setPreset] = useState<PeriodPreset>('week');
  const [customFrom, setCustomFrom] = useState(localDate(addDays(new Date(), -6)));
  const [customTo, setCustomTo] = useState(localDate(new Date()));

  const range = useMemo(() => {
    const today = new Date();
    if (preset === 'today') {
      const value = localDate(today);
      return { dateFrom: value, dateTo: value };
    }
    if (preset === 'month') {
      return { dateFrom: localDate(addDays(today, -29)), dateTo: localDate(today) };
    }
    if (preset === 'custom') {
      return { dateFrom: customFrom, dateTo: customTo };
    }
    return { dateFrom: localDate(addDays(today, -6)), dateTo: localDate(today) };
  }, [customFrom, customTo, preset]);

  return (
    <div className="space-y-4">
      {tab !== 'dishes' && (
        <div className="flex flex-wrap items-center gap-2">
          {locations.length > 1 ? (
            <Select
              ariaLabel="Склад"
              value={(needsWarehouse ? stockWarehouse : selectedWarehouse)?.id ?? ''}
              options={[
                ...(needsWarehouse ? [] : [{ value: '', label: 'Все склады' }]),
                ...locations.map(({ id, name }) => ({ value: id, label: name })),
              ]}
              onChange={setWarehouseId}
              className="h-10 min-w-44"
            />
          ) : (
            <span className="text-sm font-medium text-text-primary">{defaultWarehouse?.name}</span>
          )}
          {isOwner && locationsQuery.data && (
            <button type="button" className="btn-secondary btn-md" onClick={() => setManageOpen(true)}>Склады и станции</button>
          )}
          {locationsQuery.isError && (
            <p role="alert" className="text-sm text-danger">{apiError(locationsQuery.error)}</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border pb-px">
        <div className="flex max-w-full flex-nowrap gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        {tab === 'overview' && (
          <div className="pb-2">
            <PeriodFilter
              preset={preset}
              setPreset={setPreset}
              customFrom={customFrom}
              customTo={customTo}
              setCustomFrom={setCustomFrom}
              setCustomTo={setCustomTo}
            />
          </div>
        )}
      </div>

      {locationsQuery.isPending && (needsWarehouse || tab === 'purchases') && (
        <div className="flex justify-center py-8 text-primary"><Spinner /></div>
      )}
      {tab === 'overview' && <WarehouseOverviewTab range={range} warehouseId={selectedWarehouse?.id} />}
      {tab === 'dishes' && <WarehousePage />}
      {tab === 'ingredients' && stockWarehouse && <IngredientsTab key={stockWarehouse.id} warehouse={stockWarehouse} locations={locations} />}
      {tab === 'preparation' && stockWarehouse && <PreparationTab key={stockWarehouse.id} warehouse={stockWarehouse} />}
      {tab === 'purchases' && defaultWarehouse && <PurchasesTab warehouseId={selectedWarehouse?.id} locations={locations} />}
      {(tab === 'inventory' || tab === 'writeoff') && stockWarehouse && (
        <StockDocumentsTab key={`${tab}:${stockWarehouse.id}`} kind={tab} warehouse={stockWarehouse} isOwner={isOwner} />
      )}
      {tab === 'movements' && <MovementsTab warehouseId={selectedWarehouse?.id} locations={locations} />}
      {manageOpen && locationsQuery.data && (
        <WarehouseLocationsModal data={locationsQuery.data} onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function PeriodFilter({
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
          <DatePicker className="input h-10 w-[145px] text-sm" value={customFrom} onChange={(value) => setCustomFrom(value)} />
          <span className="text-text-muted">-</span>
          <DatePicker className="input h-10 w-[145px] text-sm" value={customTo} onChange={(value) => setCustomTo(value)} />
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
