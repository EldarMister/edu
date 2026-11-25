import { useId, useState } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { useIngredientCategoryMutations } from './api';
import { DocumentField } from './WarehouseUi';

export function NewIngredientCategory({ onClose, onSaved }: {
  onClose: () => void;
  onSaved?: (name: string) => void;
}) {
  const formId = useId();
  const [name, setName] = useState('');
  const { save } = useIngredientCategoryMutations();
  const close = () => { if (!save.isPending) onClose(); };
  return <Modal open manageFocus title="Новая категория ингредиентов" onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" disabled={save.isPending} onClick={close}>Отмена</button>
    <button type="submit" form={formId} className="btn-primary btn-md" disabled={save.isPending || !name.trim()}>
      {save.isPending ? 'Сохранение…' : 'Добавить'}
    </button>
  </div>}>
    <form id={formId} onSubmit={(event) => {
      event.preventDefault();
      if (name.trim() && !save.isPending) save.mutate({ name }, { onSuccess: (category) => {
        onSaved?.(category.name);
        onClose();
      } });
    }}>
      <DocumentField label="Название">
        <input aria-label="Название категории" className="input w-full" data-dialog-initial-focus
          value={name} maxLength={120} required disabled={save.isPending} onChange={(event) => setName(event.target.value)} />
      </DocumentField>
      {save.isError && <p role="alert" className="mt-2 text-sm text-danger">{apiError(save.error)}</p>}
    </form>
  </Modal>;
}
