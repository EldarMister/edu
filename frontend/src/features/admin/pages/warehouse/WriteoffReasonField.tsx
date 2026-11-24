import { useId, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useSaveWriteoffReason, useWriteoffReasons, type WriteoffReasonOption } from './stock-documents-api';
import { WRITEOFF_REASONS } from './stock-document-format';
import { EditorPage } from './EditorPage';
import { DocumentField, DocumentFooter } from './WarehouseUi';

const addReason = '__add_reason';

export function writeoffReasonInput(value: string) {
  const builtin = WRITEOFF_REASONS.find((reason) => reason.value === value);
  return { reason: builtin?.value ?? null, writeoffReasonId: value && !builtin ? value : null };
}

export function WriteoffReasonField({ value, disabled, onChange }: {
  value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const { can } = usePermissions();
  const reasons = useWriteoffReasons();
  const [open, setOpen] = useState(false);
  const options = reasons.data?.map(({ id, label }) => ({ value: id, label })) ?? WRITEOFF_REASONS;
  const allowCreate = can('actions.warehouseSettings');
  return <div>
    <Select className="h-10 w-full" ariaLabel="Причина списания" disabled={disabled} value={value}
      onChange={(next) => { if (next === addReason) setOpen(true); else onChange(next); }}
      options={[{ value: '', label: 'Без причины' }, ...options, ...(allowCreate ? [{ value: addReason, label: '+ Добавить причину' }] : [])]} />
    {reasons.isError && <button type="button" className="mt-1 text-xs text-danger" onClick={() => void reasons.refetch()}>Повторить загрузку причин</button>}
    {open && <WriteoffReasonEditor onClose={() => setOpen(false)} onSaved={(reason) => { onChange(reason.id); setOpen(false); }} />}
  </div>;
}

export function WriteoffReasonEditor({ reason, page, onClose, onSaved }: {
  reason?: WriteoffReasonOption; page?: boolean; onClose: () => void; onSaved: (reason: WriteoffReasonOption) => void;
}) {
  const formId = useId();
  const [name, setName] = useState(reason?.label ?? '');
  const [expense, setExpense] = useState(reason?.expense ?? false);
  const save = useSaveWriteoffReason();
  const close = () => { if (!save.isPending) onClose(); };
  const title = reason ? 'Редактирование причины списания' : 'Новая причина списания';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || save.isPending) return;
    save.mutate({ id: reason?.id, name, expense }, { onSuccess: onSaved });
  }
  const fields = <form id={formId} onSubmit={submit} className="space-y-4">
    <DocumentField label="Название">
      <input className="input h-10 w-full" data-dialog-initial-focus maxLength={120} required disabled={save.isPending}
        value={name} onChange={(event) => setName(event.target.value)} />
    </DocumentField>
    <DocumentField label="Учитывать в блоке P&L">
      <div className="flex flex-wrap gap-x-6 gap-y-2 py-1">
        <label className="flex items-center gap-2"><input type="radio" name={formId} checked={!expense} disabled={save.isPending}
          onChange={() => setExpense(false)} /> Себестоимость</label>
        <label className="flex items-center gap-2"><input type="radio" name={formId} checked={expense} disabled={save.isPending}
          onChange={() => setExpense(true)} /> Расходы</label>
      </div>
    </DocumentField>
    {save.isError && <p role="alert" className="text-sm text-danger">{apiError(save.error)}</p>}
  </form>;
  const actions = <>
    <button type="submit" form={formId} className="btn-primary btn-md" disabled={!name.trim() || save.isPending}>
      {save.isPending ? 'Сохранение…' : 'Сохранить'}
    </button>
    <button type="button" className="btn-secondary btn-md" onClick={close} disabled={save.isPending}>Отмена</button>
  </>;
  return page ? <EditorPage title={title} onClose={close} dirty={name !== (reason?.label ?? '') || expense !== (reason?.expense ?? false)}>
    <div className="poster-document-panel poster-document-fields max-w-4xl border border-border p-5">{fields}</div>
    <DocumentFooter>{actions}</DocumentFooter>
  </EditorPage> : <Modal open manageFocus title={title} onClose={close} panelClassName="max-w-2xl"
    footer={<div className="flex justify-end gap-2">{actions}</div>}>{fields}</Modal>;
}
