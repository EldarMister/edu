import { useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { api, apiError } from '@/lib/api';
import { IconExport } from '../../components/icons';

export function RecipeExportButton({ kind, ids, pending }: {
  kind: 'recipes' | 'preparations';
  ids: string[];
  pending?: boolean;
}) {
  const recipes = kind === 'recipes';
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [composition, setComposition] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !ids.length) return;
    submitting.current = true;
    setExporting(true);
    setError('');
    try {
      const response = await api.post<Blob>('/admin/warehouse/recipe-export.xlsx', {
        kind, ids, includeComposition: composition,
      }, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = recipes ? 'Техкарты.xlsx' : 'Полуфабрикаты.xlsx';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      submitting.current = false;
      setExporting(false);
    }
  }

  function close() {
    if (!submitting.current) setOpen(false);
  }

  return <>
    <button type="button" className="supply-header-action" title="Экспорт" aria-haspopup="dialog" data-catalogue-disclosure disabled={pending || !ids.length} onClick={() => {
      setComposition(false);
      setError('');
      setOpen(true);
    }}><IconExport aria-hidden="true" /><span className="catalogue-action-label">Экспорт</span></button>
    {open && <Modal open manageFocus title={recipes ? 'Экспорт техкарт' : 'Экспорт полуфабрикатов'} onClose={close}
      footer={<div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-md" onClick={close} disabled={exporting}>Отмена</button>
        <button form={formId} type="submit" className="btn-primary btn-md" disabled={exporting || !ids.length}>
          <IconExport />{exporting ? 'Выгрузка…' : 'Выгрузить'}
        </button>
      </div>}>
      <form id={formId} onSubmit={(event) => void download(event)} className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-dialog-initial-focus checked={composition} disabled={exporting}
            onChange={(event) => setComposition(event.target.checked)} />
          С составом
        </label>
        <p className="text-sm text-text-secondary">В Excel попадут позиции по текущим фильтрам.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>}
  </>;
}
