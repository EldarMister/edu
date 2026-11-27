import { IconExport } from '@/features/admin/components/icons';
import { useRef, useState } from 'react';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { downloadStockDocument, type ExportableStockDocument } from './stock-documents-api';

export function StockDocumentExportButton({ id, kind, disabled = false }: {
  id: string; kind: ExportableStockDocument; disabled?: boolean;
}) {
  const push = useNotifications((state) => state.push);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  async function download() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await downloadStockDocument(id, kind);
    } catch (failure) {
      push({ message: apiError(failure), type: 'error', at: new Date().toISOString() });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const label = kind === 'transfer' ? 'Скачать акт XLSX' : 'Скачать XLSX';
  return <button type="button" className="workspace-tool" disabled={disabled || pending}
    title={disabled ? 'Сначала сохраните изменения' : undefined} onClick={() => void download()}>
    <IconExport />{pending ? 'Выгрузка…' : label}
  </button>;
}
