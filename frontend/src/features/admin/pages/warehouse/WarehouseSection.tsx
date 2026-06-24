import { useMemo, useState } from 'react';
import { WarehousePage } from '../WarehousePage';
import { IngredientsTab } from './IngredientsTab';
import { PurchasesTab } from './PurchasesTab';
import { MovementsTab } from './MovementsTab';
import { WarehouseOverviewTab } from './WarehouseOverviewTab';

type Tab = 'overview' | 'dishes' | 'ingredients' | 'purchases' | 'movements';
type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'dishes', label: 'Блюда' },
  { key: 'ingredients', label: 'Сырьё' },
  { key: 'purchases', label: 'Закупки' },
  { key: 'movements', label: 'Движения' },
];

/** Раздел «Склад»: верхние табы Блюда / Сырьё / Закупки / Движения. */
export function WarehouseSection() {
  const [tab, setTab] = useState<Tab>('overview');
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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border pb-px">
        <div className="flex flex-wrap gap-1">
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

      {tab === 'overview' && <WarehouseOverviewTab range={range} />}
      {tab === 'dishes' && <WarehousePage />}
      {tab === 'ingredients' && <IngredientsTab />}
      {tab === 'purchases' && <PurchasesTab />}
      {tab === 'movements' && <MovementsTab />}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
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
          <input className="input h-10 w-[145px] text-sm" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="text-text-muted">-</span>
          <input className="input h-10 w-[145px] text-sm" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
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
