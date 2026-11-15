import type { usePermissions } from '@/hooks/usePermissions';

export function canOpenMovementSource(type: string | null, permissions: ReturnType<typeof usePermissions>) {
  if (type === 'order') return permissions.canSection('orders');
  if (!permissions.canSection('warehouse')) return false;
  if (type === 'purchase') return permissions.canAction('warehouseReceive') && permissions.canAction('warehouseCosts');
  return type !== null && ['production', 'processing', 'inventory', 'writeoff', 'transfer', 'supplier_return', 'document'].includes(type);
}
