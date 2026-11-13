import { Modal } from '@/components/Modal';
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
  const { can } = usePermissions();
  const warehouse = locations.data?.locations.find((l) => l.isDefault) ?? locations.data?.locations[0];
  if (type === 'order') return <OrderSource id={id} onClose={onClose} />;
  if (type === 'production') return <ProductionBatchModal id={id} onClose={onClose} />;
  if (!warehouse)
    return (
      <Modal open title="Документ" onClose={onClose}>
        <QueryState pending={locations.isPending} error={locations.error} />
      </Modal>
    );
  if (type === 'purchase')
    return (
      <PurchaseModal
        id={id}
        warehouseId={warehouse.id}
        locations={locations.data?.locations ?? []}
        onClose={onClose}
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
    <OrderDetailsModal order={q.data} onClose={onClose} />
  ) : (
    <Modal open title="Заказ" onClose={onClose}>
      <QueryState pending={q.isPending} error={q.error} />
    </Modal>
  );
}
