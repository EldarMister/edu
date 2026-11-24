import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { inventoryQuantity } from './inventory-workflow';
import { useInventoryContext, type StockDocumentItem } from './stock-documents-api';
import { formatDocumentListDate } from './WarehouseDocumentLists';
import { QueryState } from './WarehouseUi';
import { canOpenMovementSource } from './movement-source';
import { useEditorRoute } from './workspace-route';

const movementLabels: Record<string, string> = {
  purchase: 'Поставка', order: 'Чек', inventory: 'Инвентаризация', writeoff: 'Списание', transfer: 'Перемещение',
  production: 'Производство', processing: 'Обработка', supplier_return: 'Возврат поставщику', manual: 'Ручная корректировка',
};

export function InventoryFlowDetails({ documentId, item }: { documentId: string; item: StockDocumentItem }) {
  const query = useInventoryContext(documentId, item.ingredientId);
  const permissions = usePermissions();
  const { openEditor } = useEditorRoute();
  const openSource = (type: string, id: string) => openEditor({ type: 'source', action: type, id });
  const context = query.data?.inventoryContext;
  const flow = context?.rows.find(({ ingredientId }) => ingredientId === item.ingredientId);
  const stored = query.data?.items.find(({ ingredientId }) => ingredientId === item.ingredientId);
  const planned = stored?.expected;

  return <div className="inventory-flow-details" aria-label={`Движение к плановому остатку: ${item.name}`}>
    <QueryState pending={query.isPending} error={query.error ? apiError(query.error) : undefined}>
      {context && flow && planned != null ? <>
        <div className="inventory-flow-dates">
          {flow.lastCountAt && flow.lastCountId && canOpenMovementSource('inventory', permissions)
            ? <button type="button" className="text-primary" onClick={() => openSource('inventory', flow.lastCountId!)}>
              Предыдущая проверка {formatDocumentListDate(flow.lastCountAt)}</button>
            : <span>{flow.lastCountAt ? `Предыдущая проверка ${formatDocumentListDate(flow.lastCountAt)}` : 'Первая проверка позиции'}</span>}
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
        {!!flow.movements?.length && <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-primary">Документы за период</summary>
          {(flow.movementCount ?? 0) > flow.movements.length && <p className="my-2 text-xs text-text-muted">
            Показано последних {flow.movements.length} из {flow.movementCount}
          </p>}
          <ul className="mt-2 space-y-2">
            {flow.movements.map((movement) => <li key={movement.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                {movement.sourceId && canOpenMovementSource(movement.sourceType, permissions)
                  ? <button type="button" className="text-primary" onClick={() => openSource(movement.sourceType, movement.sourceId!)}>
                    {movementLabels[movement.sourceType] ?? 'Документ'}</button>
                  : <span>{movementLabels[movement.sourceType] ?? 'Движение'}</span>}
                <span className="ml-2 text-text-muted">{formatDocumentListDate(movement.createdAt)}{movement.actorName && ` · ${movement.actorName}`}</span>
                {movement.comment && <p className="break-words text-xs text-text-muted">{movement.comment}</p>}
              </div>
              <span className="whitespace-nowrap tabular-nums">{inventoryQuantity(movement.change, item.unit, true)}</span>
            </li>)}
          </ul>
        </details>}
      </> : <p className="text-sm text-text-muted">{stored
        ? 'Расшифровка для этой позиции недоступна.'
        : 'Данные появятся после сохранения позиции в инвентаризации.'}</p>}
    </QueryState>
  </div>;
}
