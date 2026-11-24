import { IconExport } from '@/features/admin/components/icons';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { downloadOrdersWorkbook, type OrderListFilters } from '../api';

export function OrdersExportButton({ filters, disabled }: { filters: OrderListFilters; disabled: boolean }) {
  const t = useT();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      await downloadOrdersWorkbook(filters, details);
      setOpen(false);
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function close() {
    if (!inFlight.current) setOpen(false);
  }

  return <>
    <button type="button" className="btn-secondary btn-md" disabled={disabled} onClick={() => {
      setDetails(false);
      setError('');
      setOpen(true);
    }}><IconExport />{t('Экспорт')}</button>
    {open && <Modal open manageFocus title={t('Экспорт чеков')} onClose={close} footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={close} disabled={pending}>{t('Отмена')}</button>
      <button form={formId} type="submit" className="btn-primary btn-md" disabled={pending || disabled}>
        <IconExport />{t(pending ? 'Выгрузка…' : 'Выгрузить XLSX')}
      </button>
    </div>}>
      <form id={formId} onSubmit={(event) => void download(event)} className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={details} disabled={pending} data-dialog-initial-focus
            onChange={(event) => setDetails(event.target.checked)} /> {t('С позициями чеков')}
        </label>
        <p className="text-sm text-text-secondary">{t('В Excel попадут все чеки по выбранным фильтрам.')}</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>}
  </>;
}
