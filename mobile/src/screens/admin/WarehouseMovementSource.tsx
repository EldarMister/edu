import React from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, View } from '@/components/themed';
import { FastPressable } from '@/components/FastPressable';
import { Text } from '@/components/typography';
import { Button } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useAdminOrderDetails } from '@/services/api/admin';
import type { WarehouseLocation, WarehouseReportMovementRow } from '@/services/api/warehouse';
import { colors, spacing } from '@/theme';
import { OrderDetailsModal } from './OrderDetailsModal';
import { DocumentSheet } from './WarehouseDocumentsTab';
import { ProcessingEditor } from './WarehouseProcessingTab';
import { ProductionBatchPage } from './WarehouseProductionTab';
import { PurchaseEditor } from './WarehousePurchaseEditor';
import { WarehouseSupplierReturnForm } from './WarehouseSupplierReturnForm';
import { WarehouseTransferForm } from './WarehouseTransferForm';
import { WarehouseWorkspace } from './WarehouseWorkspace';

type Movement = Pick<WarehouseReportMovementRow, 'sourceType' | 'sourceId' | 'documentLabel'>;
type Permission = ReturnType<typeof usePermissions>;
const linkedSources = ['inventory', 'writeoff', 'transfer', 'processing', 'production', 'supplier_return'];

function canOpenSource(movement: Movement, { canSection, canAction }: Permission) {
  if (!movement.sourceId || !movement.sourceType) return false;
  if (movement.sourceType === 'order') return canSection('orders');
  if (!canSection('warehouse')) return false;
  if (movement.sourceType === 'purchase') return canAction('warehouseReceive') && canAction('warehouseCosts');
  return linkedSources.includes(movement.sourceType);
}

export function MovementSourceLink({ movement, fallback, onOpen }: {
  movement: Movement; fallback: string; onOpen: () => void;
}) {
  const permissions = usePermissions();
  const label = movement.documentLabel ?? fallback;
  return canOpenSource(movement, permissions)
    ? <FastPressable accessibilityRole="link" onPress={onOpen}><Text style={styles.link}>{label}</Text></FastPressable>
    : <Text style={styles.text}>{label}</Text>;
}

export function MovementSourcePage({ movement, locations, onClose }: {
  movement: Movement; locations: WarehouseLocation[]; onClose: () => void;
}) {
  const permissions = usePermissions();
  const id = movement.sourceId;
  if (!id || !canOpenSource(movement, permissions)) return null;
  switch (movement.sourceType) {
    case 'purchase':
      return <PurchaseEditor purchaseId={id} warehouseLabel={(warehouseId) =>
        locations.find((location) => location.id === warehouseId)?.name ?? '—'} onClose={onClose} />;
    case 'supplier_return':
      return <WarehouseSupplierReturnForm documentId={id} locations={locations} onClose={onClose} />;
    case 'processing':
      return <ProcessingEditor id={id} locations={locations} onClose={onClose} />;
    case 'production':
      return <ProductionBatchPage id={id} locations={locations} onClose={onClose} />;
    case 'transfer':
      return <WarehouseTransferForm documentId={id} locations={locations} onClose={onClose} />;
    case 'inventory':
    case 'writeoff':
      return <DocumentSheet id={id} locations={locations} onClose={onClose} />;
    case 'order':
      return <OrderSource id={id} onClose={onClose} />;
    default:
      return null;
  }
}

function OrderSource({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdminOrderDetails(id);
  if (query.data) return <OrderDetailsModal order={query.data} onClose={onClose} />;
  return <WarehouseWorkspace title="Заказ" onClose={onClose}>
    <View style={styles.content}>
      {query.isPending ? <ActivityIndicator color={colors.primary} /> : <>
        <Text style={styles.error} accessibilityRole="alert">{apiError(query.error)}</Text>
        <Button title="Повторить" variant="secondary" size="md" onPress={() => void query.refetch()} />
      </>}
    </View>
  </WarehouseWorkspace>;
}

const styles = StyleSheet.create({
  text: { color: colors.textPrimary, fontSize: 13 },
  link: { color: colors.primary, fontSize: 13 },
  content: { padding: spacing.md, gap: spacing.md },
  error: { color: colors.danger, fontSize: 13 },
});
