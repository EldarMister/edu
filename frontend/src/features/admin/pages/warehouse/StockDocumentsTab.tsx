import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { IconPlus } from '../../components/icons';
import { type WarehouseLocation } from './api';
import { StockDocumentModal } from './StockDocumentModal';
import {
  useStockDocumentMutations, useStockDocuments,
  type InventoryMode, type StockDocumentKind,
} from './stock-documents-api';
import { documentLabel, documentStatus, formatDocumentDate, formatVariance } from './stock-document-format';

export function StockDocumentsTab({ kind, warehouse, isOwner }: {
  kind: StockDocumentKind;
  warehouse: WarehouseLocation;
  isOwner: boolean;
}) {
  const documents = useStockDocuments(warehouse.id, kind);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [choosingMode, setChoosingMode] = useState(false);
  const [error, setError] = useState('');
  const { create } = useStockDocumentMutations();
  const inventory = kind === 'inventory';

  async function createDocument(mode?: InventoryMode) {
    setError('');
    try {
      const document = await create.mutateAsync({ warehouseId: warehouse.id, kind, mode });
      setChoosingMode(false);
      setActiveId(document.id);
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h3 className="text-[15px] font-semibold text-text-primary">{inventory ? 'История инвентаризаций' : 'Акты списания'}</h3>
        <button type="button" className="btn-primary btn-md" disabled={create.isPending}
          onClick={() => inventory ? setChoosingMode(true) : void createDocument()}>
          <IconPlus className="h-4 w-4" /> {inventory ? 'Новая инвентаризация' : 'Новое списание'}
        </button>
      </div>
      {(documents.isError || (error && !choosingMode)) && (
        <p role="alert" className="p-4 text-sm text-danger">{error || apiError(documents.error)}</p>
      )}
      {documents.isPending && <div className="flex justify-center py-8 text-primary"><Spinner /></div>}
      {documents.data?.length === 0 && <p className="p-4 text-sm text-text-muted">Документов пока нет</p>}
      {!!documents.data?.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[580px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Документ</th>
                <th scope="col" className="px-4 py-3 font-medium">Статус</th>
                <th scope="col" className="px-4 py-3 font-medium">Позиций</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">{inventory ? 'Разница, с' : 'Сумма, с'}</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {documents.data.map((document) => (
                <tr key={document.id} className="hover:bg-background/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary">{documentLabel(document)}</div>
                    <div className="text-xs text-text-muted">{formatDocumentDate(document.createdAt)}{document.createdByName && ` · ${document.createdByName}`}</div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{documentStatus(document.status)}</td>
                  <td className="px-4 py-3 text-text-secondary">{document.itemsCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-text-primary">{formatVariance(document.varianceValue)}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="btn-secondary btn-md" onClick={() => setActiveId(document.id)}>Открыть</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {choosingMode && (
        <Modal open title="Новая инвентаризация" onClose={() => { setChoosingMode(false); setError(''); }}>
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">{warehouse.name}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary btn-md" disabled={create.isPending} onClick={() => void createDocument('full')}>Полная</button>
              <button type="button" className="btn-secondary btn-md" disabled={create.isPending} onClick={() => void createDocument('partial')}>Частичная</button>
            </div>
            <p className="text-xs text-text-muted">Для полной нужно посчитать все позиции. Для частичной выберите сырьё сами.</p>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </div>
        </Modal>
      )}
      {activeId && <StockDocumentModal key={activeId} id={activeId} warehouse={warehouse} isOwner={isOwner} onClose={() => setActiveId(null)} />}
    </div>
  );
}
