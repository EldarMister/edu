import { SourceDocumentModal } from './SourceDocumentModal';
import { useState } from 'react';
import { IngredientsTab, type StockFilter } from './IngredientsTab';
import { ItemCard } from './ItemCard';
import { PreparationModal } from './PreparationTab';
import { WarehouseReportsTab } from './WarehouseReportsTab';
import { DatePicker } from '@/components/DatePicker';
import { Modal } from '@/components/Modal';
import { useWarehouseLocations, type Ingredient } from './api';
export function MenuStockCatalogue({ view }: { view: 'ingredients' | 'preparations' }) {
  const [filter, setFilter] = useState<StockFilter>('');
  const [item, setItem] = useState<string | null | undefined>(undefined);
  const [prep, setPrep] = useState<{ item: Ingredient; kind: 'recipe' | 'produce' }>();
  const [history, setHistory] = useState<string>();
  const [report, setReport] = useState('movements');
  const [source, setSource] = useState<{ type: string; id: string }>();
  const locations = useWarehouseLocations();
  const warehouse = locations.data?.locations.find((l) => l.isDefault) ?? locations.data?.locations[0];
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toLocaleDateString('en-CA');
  });
  return (
    <>
      <IngredientsTab
        catalogue={view}
        filter={filter}
        onFilter={setFilter}
        onOpen={(i) => (view === 'preparations' ? setPrep({ item: i, kind: 'recipe' }) : setItem(i.id))}
        onCreate={() => setItem(null)}
        onHistory={setHistory}
        onProduce={(i) => setPrep({ item: i, kind: 'produce' })}
      />
      {item !== undefined && (
        <ItemCard
          id={item ?? undefined}
          defaultKind={view === 'preparations' ? 'preparation' : 'raw'}
          onClose={() => setItem(undefined)}
          onSaved={(i) => {
            if (i.isPrepared) setPrep({ item: i, kind: 'recipe' });
          }}
          onRecipe={(i) => {
            setItem(undefined);
            setPrep({ item: i, kind: 'recipe' });
          }}
        />
      )}
      {prep && warehouse && (
        <PreparationModal
          action={{ kind: prep.kind, id: prep.item.id, name: prep.item.name }}
          warehouse={warehouse}
          onClose={() => setPrep(undefined)}
          onEditItem={() => {
            setPrep(undefined);
            setItem(prep.item.id);
          }}
        />
      )}
      {history && (
        <Modal open title="История позиции" panelClassName="max-w-6xl" onClose={() => setHistory(undefined)}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm">Период:</span>
            <DatePicker value={dateFrom} onChange={setDateFrom} className="input h-10 w-36" />
            <span>—</span>
            <DatePicker value={dateTo} onChange={setDateTo} className="input h-10 w-36" />
          </div>
          <WarehouseReportsTab
            range={{ dateFrom, dateTo }}
            ingredientId={history}
            view={report}
            onView={setReport}
            onOpen={(type, id) => setSource({ type, id })}
          />
        </Modal>
      )}
      {source && <SourceDocumentModal {...source} onClose={() => setSource(undefined)} />}
    </>
  );
}
