import { SourceDocumentModal } from './SourceDocumentModal';
import { IngredientsTab, type StockFilter } from './IngredientsTab';
import { ItemCard } from './ItemCard';
import { PreparationCardPage, PreparationModal, ProductionBatchModal } from './PreparationTab';
import { WarehouseReportsTab } from './WarehouseReportsTab';
import { DatePicker } from '@/components/DatePicker';
import { EditorPage } from './EditorPage';
import { useEditorRoute, usePageFilter } from './workspace-route';
import { useWarehouseLocations } from './api';
import { QueryState } from './WarehouseUi';

export function MenuStockCatalogue({ view }: { view: 'ingredients' | 'preparations' }) {
  const [filter, setFilter] = usePageFilter('stockFilter');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const locations = useWarehouseLocations();
  const warehouse = locations.data?.locations.find((l) => l.isDefault) ?? locations.data?.locations[0];
  const today = new Date().toLocaleDateString('en-CA');
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const [dateTo, setDateTo] = usePageFilter('dateTo', today);
  const [dateFrom, setDateFrom] = usePageFilter('dateFrom', start.toLocaleDateString('en-CA'));
  if (editor?.type === 'source' && editor.id && editor.action)
    return <SourceDocumentModal type={editor.action} id={editor.id} onClose={closeEditor} />;
  if ((editor?.type === 'productionBatch' || editor?.type === 'batch') && editor.id)
    return <ProductionBatchModal id={editor.id} onClose={closeEditor} />;
  if (editor?.type === 'preparation')
    return <PreparationCardPage id={editor.id} warehouseId={warehouse?.id} onClose={closeEditor} />;
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
  if (editor?.type === 'item')
    return (
      <ItemCard
        id={editor.id}
        defaultKind="raw"
        onClose={closeEditor}
        onHistory={(id) => openEditor({ type: 'history', id })}
        onRecipe={(item) => openEditor({ type: 'preparation', id: item.id })}
      />
    );
  if (editor?.type === 'history' && editor.id)
    return (
      <EditorPage title="История позиции" onClose={closeEditor}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm">Период:</span>
          <DatePicker value={dateFrom} onChange={setDateFrom} className="input h-10 w-36" />
          <span>—</span>
          <DatePicker value={dateTo} onChange={setDateTo} className="input h-10 w-36" />
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
