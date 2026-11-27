import { SourceDocumentModal } from './SourceDocumentModal';
import { IngredientsTab, type StockFilter } from './IngredientsTab';
import { ItemCard } from './ItemCard';
import { PreparationCardPage, PreparationModal, ProductionBatchModal } from './PreparationTab';
import { WarehouseReportsTab } from './WarehouseReportsTab';
import { FinancePeriod } from '../finance/FinancePeriod';
import { calendarDate, warehouseDay } from './warehouse-period';
import { EditorPage } from './EditorPage';
import { useEditorRoute, usePageFilter, usePageFilters } from './workspace-route';
import { useWarehouseLocations } from './api';
import { QueryState } from './WarehouseUi';

export function MenuStockCatalogue({ view }: { view: 'ingredients' | 'preparations' }) {
  const [filter, setFilter] = usePageFilter('stockFilter');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const locations = useWarehouseLocations();
  const warehouse = locations.data?.locations.find((l) => l.isDefault) ?? locations.data?.locations[0];
  const today = warehouseDay();
  const [{ dateFrom, dateTo }, setDates] = usePageFilters({ dateFrom: calendarDate(today, -30), dateTo: calendarDate(today) });
  if (editor?.type === 'source' && editor.id && editor.action)
    return <SourceDocumentModal type={editor.action} id={editor.id} onClose={closeEditor} />;
  if ((editor?.type === 'productionBatch' || editor?.type === 'batch') && editor.id)
    return <ProductionBatchModal id={editor.id} onClose={closeEditor} />;
  if (editor?.type === 'preparation')
    return <PreparationCardPage id={editor.id} copy={editor.action === 'copy'} warehouseId={warehouse?.id} onClose={closeEditor} />;
  if (editor?.type === 'item')
    return <ItemCard key={editor.id ?? 'new'} id={editor.id} defaultKind="raw" onClose={closeEditor}
      onHistory={(id) => openEditor({ type: 'history', id })}
      onRecipe={(item) => openEditor({ type: 'preparation', id: item.id })} />;
  if (editor?.type === 'produce' && editor.id)
    return warehouse ? (
      <PreparationModal
        action={{ kind: 'produce', id: editor.id, name: 'Полуфабрикат' }}
        warehouse={warehouse}
        onClose={closeEditor}
        onBatch={(id) => openEditor({ type: 'productionBatch', id })}
      />
    ) : (
      <EditorPage title="Производство" onClose={closeEditor}>
        <QueryState pending={locations.isPending} error={locations.error} empty={locations.isSuccess} />
      </EditorPage>
    );
  if (editor?.type === 'history' && editor.id)
    return (
      <EditorPage title="История позиции" onClose={closeEditor}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FinancePeriod from={dateFrom} to={dateTo} onApply={({ from, to }) => setDates({ dateFrom: from, dateTo: to })} />
        </div>
        <WarehouseReportsTab
          range={{ dateFrom, dateTo }}
          ingredientId={editor.id}
          contextOnly
          view="movements"
          onView={() => {}}
          onOpen={(type, id) => openEditor({ type: 'source', action: type, id })}
        />
      </EditorPage>
    );
  return (
    <IngredientsTab
      catalogue={view}
      filter={filter as StockFilter}
      onFilter={setFilter}
      onOpen={(item) =>
        openEditor({
          type: view === 'preparations' ? 'preparation' : 'item',
          id: item.id,
        })
      }
      onCreate={() => openEditor({ type: view === 'preparations' ? 'preparation' : 'item' })}
      onHistory={(id) => openEditor({ type: 'history', id })}
      onProduce={(item) => openEditor({ type: 'produce', id: item.id })}
    />
  );
}
