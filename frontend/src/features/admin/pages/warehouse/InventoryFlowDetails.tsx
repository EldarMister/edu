import { apiError } from '@/lib/api';
import { inventoryQuantity } from './inventory-workflow';
import { useInventoryContext, type StockDocumentItem } from './stock-documents-api';
import { formatDocumentListDate } from './WarehouseDocumentLists';
import { QueryState } from './WarehouseUi';

export function InventoryFlowDetails({ documentId, item }: { documentId: string; item: StockDocumentItem }) {
  const query = useInventoryContext(documentId);
  const context = query.data?.inventoryContext;
  const flow = context?.rows.find(({ ingredientId }) => ingredientId === item.ingredientId);
  const stored = query.data?.items.find(({ ingredientId }) => ingredientId === item.ingredientId);
  const planned = stored?.expected;

  return <div className="inventory-flow-details" aria-label={`Движение к плановому остатку: ${item.name}`}>
    <QueryState pending={query.isPending} error={query.error ? apiError(query.error) : undefined}>
      {context && flow && planned != null ? <>
        <div className="inventory-flow-dates">
          <span>{flow.lastCountAt ? `Предыдущая проверка: ${formatDocumentListDate(flow.lastCountAt)}` : 'Первая проверка позиции'}</span>
          <span>Движения по {formatDocumentListDate(context.cutoffAt)}</span>
        </div>
        <dl>
          {[
            { label: 'Начальный остаток', amount: flow.openingQuantity },
            { label: 'Поступления', amount: flow.incomingQuantity, signed: true },
            { label: 'Расход по продажам', amount: flow.consumptionQuantity, signed: true },
            { label: 'Ручные списания', amount: flow.writeoffQuantity, signed: true },
            ...(flow.otherQuantity !== 0 ? [{ label: 'Другие движения', amount: flow.otherQuantity, signed: true }] : []),
            { label: 'Плановый остаток', amount: planned },
          ].map(({ label, amount, signed }) => <div key={label}>
            <dt>{label}</dt><dd>{inventoryQuantity(amount, item.unit, signed)}</dd>
          </div>)}
        </dl>
      </> : <p className="text-sm text-text-muted">{stored
        ? 'Расшифровка для этой позиции недоступна.'
        : 'Данные появятся после сохранения позиции в инвентаризации.'}</p>}
    </QueryState>
  </div>;
}
