import React, { useState } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { WarehouseDocumentRegister, type DocumentRegisterScope } from './WarehouseDocumentRegister';
import { WarehouseTransferForm } from './WarehouseTransferForm';

export function WarehouseTransfersTab(scope: DocumentRegisterScope) {
  const { canAction } = usePermissions();
  const [open, setOpen] = useState<string>();
  const [creating, setCreating] = useState(false);
  const { locations, warehouseId } = scope;
  const source = locations.find((warehouse) => warehouse.id === warehouseId)
    ?? locations.find((warehouse) => warehouse.isDefault) ?? locations[0];
  return <>
    <WarehouseDocumentRegister {...scope} kind="transfer" showCost={canAction('warehouseCosts')}
      canCreate={canAction('warehouseTransfer')} onCreate={locations.length > 1 ? () => setCreating(true) : undefined}
      onOpen={setOpen} />
    {creating ? <WarehouseTransferForm source={source} locations={locations} onClose={() => setCreating(false)} /> : null}
    {open ? <WarehouseTransferForm key={open} documentId={open} locations={locations} onClose={() => setOpen(undefined)} /> : null}
  </>;
}
