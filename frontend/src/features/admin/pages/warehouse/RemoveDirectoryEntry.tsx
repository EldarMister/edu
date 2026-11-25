import type { ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';

export function RemoveDirectoryEntry({ title, children, pending, error, onClose, onRemove }: {
  title: string;
  children: ReactNode;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onRemove: () => void;
}) {
  const close = () => { if (!pending) onClose(); };
  return <Modal open manageFocus title={title} onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" data-dialog-initial-focus onClick={close} disabled={pending}>Отмена</button>
    <button type="button" className="btn-danger btn-md" onClick={onRemove} disabled={pending}>
      {pending ? 'Удаление…' : 'Удалить'}
    </button>
  </div>}>
    <p className="text-sm text-text-secondary">{children}</p>
    {!!error && <p role="alert" className="mt-2 text-sm text-danger">{apiError(error)}</p>}
  </Modal>;
}
