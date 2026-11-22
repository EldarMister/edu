import React, { useState } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { WarehouseDocumentRegister, type DocumentRegisterScope } from './WarehouseDocumentRegister';
import { WarehouseTransferForm } from './WarehouseTransferForm';

export function WarehouseTransfersTab(scope: DocumentRegisterScope) {
  const { canAction } = usePermissions();
  const [open, setOpen] = useState<string>();
  const [copy, setCopy] = useState<string>();
  const [creating, setCreating] = useState(false);
  const canTransfer = canAction('warehouseTransfer');
  const { locations, warehouseId } = scope;
  const source = locations.find((warehouse) => warehouse.id === warehouseId)
    ?? locations.find((warehouse) => warehouse.isDefault) ?? locations[0];
  return <>
    <WarehouseDocumentRegister {...scope} kind="transfer" showCost={canAction('warehouseCosts')}
      canCreate={canTransfer} onCreate={locations.length > 1 ? () => setCreating(true) : undefined}
      onOpen={setOpen} onCopy={canTransfer && locations.length > 1 ? setCopy : undefined} canExport={canAction('exportReports')} />
    {creating ? <WarehouseTransferForm source={source} locations={locations} onClose={() => setCreating(false)} /> : null}
    {open ? <WarehouseTransferForm key={open} documentId={open} locations={locations} onClose={() => setOpen(undefined)} /> : null}
    {copy ? <WarehouseTransferForm key={'copy-' + copy} copyDocumentId={copy} locations={locations} onClose={() => setCopy(undefined)} /> : null}
  </>;
}
