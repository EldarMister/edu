import { EditorPage } from './EditorPage';
import { useEditorRoute } from './workspace-route';
import { StartDocumentModal } from './StockDocumentsTab';
import { usePermissions } from '@/hooks/usePermissions';
import { useWarehouseLocations } from './api';
import { useAdminOrderDetails } from '../../api';
import { OrderDetailsModal } from '../../components/OrderDetailsModal';
import { PurchaseModal } from './PurchasesTab';
import { StockDocumentModal } from './StockDocumentModal';
import { ProductionBatchModal } from './PreparationTab';
import { ProcessingModal } from './ProcessingPage';
import { QueryState } from './WarehouseUi';
export function SourceDocumentModal({
  type,
  id,
  onClose,
}: {
  type: string;
  id: string;
  onClose: () => void;
}) {
  const locations = useWarehouseLocations();
  const { editor, openEditor } = useEditorRoute();
  const { can } = usePermissions();
  const warehouse = locations.data?.locations.find((l) => l.isDefault) ?? locations.data?.locations[0];
  if (type === 'order') return <OrderSource id={id} onClose={onClose} />;
  if (type === 'production') return <ProductionBatchModal id={id} onClose={onClose} />;
  if (!warehouse)
    return (
      <EditorPage open title="Документ" onClose={onClose}>
        <QueryState pending={locations.isPending} error={locations.error} />
      </EditorPage>
    );
  if (type === 'supplier_return_new')
    return (
      <StartDocumentModal
        kind="supplier_return"
        warehouseId={editor?.warehouseId ?? warehouse.id}
        locations={locations.data?.locations ?? []}
        sourcePurchaseId={id}
        onClose={onClose}
        onCreated={(documentId) => openEditor({ type: 'source', action: 'document', id: documentId }, true)}
      />
    );
  if (type === 'purchase')
    return (
      <PurchaseModal
        id={id}
        warehouseId={warehouse.id}
        locations={locations.data?.locations ?? []}
        onClose={onClose}
        onReturn={(purchaseId, warehouseId) =>
          openEditor({ type: 'source', action: 'supplier_return_new', id: purchaseId, warehouseId })
        }
      />
    );
  if (type === 'processing')
    return (
      <ProcessingModal
        id={id}
        warehouseId={warehouse.id}
        locations={locations.data?.locations ?? []}
        onClose={onClose}
      />
    );
  return (
    <StockDocumentModal
      id={id}
      warehouse={warehouse}
      isOwner={can('actions.warehouseApprove')}
      onClose={onClose}
    />
  );
}
function OrderSource({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdminOrderDetails(id);
  return q.data ? (
    <OrderDetailsModal order={q.data} onClose={onClose} presentation="page" />
  ) : (
    <EditorPage open title="Заказ" onClose={onClose}>
      <QueryState pending={q.isPending} error={q.error} />
    </EditorPage>
  );
}
