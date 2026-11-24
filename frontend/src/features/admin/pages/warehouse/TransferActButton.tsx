import { useRef, useState } from 'react';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { downloadTransferAct } from './stock-documents-api';

export function TransferActButton({ id }: { id: string }) {
  const push = useNotifications((state) => state.push);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  async function download() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await downloadTransferAct(id);
    } catch (failure) {
      push({ message: apiError(failure), type: 'error', at: new Date().toISOString() });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <button type="button" className="btn-ghost btn-md text-primary" disabled={pending} onClick={() => void download()}>
    {pending ? 'Выгрузка…' : 'Скачать акт XLSX'}
  </button>;
}
