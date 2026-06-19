import { useState } from 'react';
import { WarehousePage } from '../WarehousePage';
import { IngredientsTab } from './IngredientsTab';
import { PurchasesTab } from './PurchasesTab';
import { MovementsTab } from './MovementsTab';
import { WarehouseOverviewTab } from './WarehouseOverviewTab';

type Tab = 'overview' | 'dishes' | 'ingredients' | 'purchases' | 'movements';

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

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-border pb-px">
        {TABS.map((t) => (
          <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </Tab>
        ))}
      </div>

      {tab === 'overview' && <WarehouseOverviewTab />}
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
