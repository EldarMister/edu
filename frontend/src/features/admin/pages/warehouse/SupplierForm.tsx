import { useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useEditorDirty } from './EditorPage';
import { useSupplierMutations, type Supplier } from './settings-api';
import { DocumentField } from './WarehouseUi';

export function SupplierForm({ supplier, initialName = '', onSaved, onClose }: {
  supplier?: Supplier;
  initialName?: string;
  onSaved?: (supplier: Supplier) => void;
  onClose: () => void;
}) {
  const permissions = usePermissions();
  const editable = permissions.canEditSection('warehouse') && permissions.canAction('warehouseSettings');
  const formId = useId();
  const { save } = useSupplierMutations();
  const [form, setForm] = useState({
    name: supplier?.name ?? initialName,
    taxId: supplier?.taxId ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
    note: supplier?.note ?? '',
    email: supplier?.email ?? '',
  });
  const initial = useRef(JSON.stringify(form));
  const dirty = editable && JSON.stringify(form) !== initial.current;
  const { markSaved } = useEditorDirty(dirty);
  const [error, setError] = useState('');
  function close() {
    if (save.isPending || dirty && !confirm('Закрыть форму и отменить изменения?')) return;
    markSaved();
    onClose();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editable || save.isPending || !form.name.trim()) return;
    try {
      const saved = await save.mutateAsync({ id: supplier?.id, ...form, name: form.name.trim() });
      onSaved?.(saved);
      markSaved();
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <Modal
      open
      onClose={close}
      title={supplier ? editable ? 'Редактирование поставщика' : 'Поставщик' : 'Новый поставщик'}
      panelClassName="max-w-lg"
      manageFocus
      footer={editable && <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-lg min-h-12 min-w-28 flex-1 sm:flex-none" onClick={close} disabled={save.isPending}>Отмена</button>
        <button type="submit" form={formId} className="btn-primary btn-lg min-h-12 min-w-28 flex-1 sm:flex-none" disabled={save.isPending || !form.name.trim()}>Сохранить</button>
      </div>}
    >
      <form id={formId} className="poster-form poster-form--directory poster-document--modern" onSubmit={submit}>
        <fieldset disabled={!editable || save.isPending} className="min-w-0">
        <div className="poster-document-panel">
        {(
          [
            { key: 'name', label: 'Название' },
            { key: 'taxId', label: 'ИНН' },
            { key: 'phone', label: 'Телефон' },
            { key: 'address', label: 'Адрес' },
            { key: 'note', label: 'Комментарий' },
          ] as const
        ).map(({ key, label }) => (
          <DocumentField key={key} label={label}>
            {key === 'address' || key === 'note' ? (
              <textarea
                className="input h-16 w-full py-2"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            ) : (
              <input
                className="input w-full"
                type={key === 'phone' ? 'tel' : 'text'}
                data-dialog-initial-focus={editable && key === 'name' || undefined}
                required={key === 'name'}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            )}
          </DocumentField>
        ))}
        <details className="poster-advanced">
          <summary>Дополнительно</summary>
          <div className="pt-3">
            <DocumentField label="Электронная почта">
              <input
                className="input w-full"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </DocumentField>
          </div>
        </details>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}
