import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { api, apiError } from '@/lib/api';
import { getDefaultPermissionsByRole } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import type { OwnerOperations } from '@/types';

const operations: { key: keyof OwnerOperations; label: string }[] = [
  { key: 'refunds', label: 'Оформлять возвраты и рассматривать заявки на возврат' },
  { key: 'cancelOrders', label: 'Отменять заказы' },
  { key: 'cancelItems', label: 'Отменять блюда и подтверждать заявки на отмену' },
  { key: 'printRequests', label: 'Отправлять и обрабатывать заявки на печать' },
];

export function OwnerOperationsEditor({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const user = useAuth((state) => state.user);
  const updateUser = useAuth((state) => state.updateUser);
  const [values, setValues] = useState<OwnerOperations>(() => ({
    refunds: true, cancelOrders: true, cancelItems: true, printRequests: true, ...user?.permissions?.ownerOperations,
  }));
  const save = useMutation({
    mutationFn: async () => (await api.patch<OwnerOperations>('/admin/positions/owner-operations', values)).data,
    onSuccess: (ownerOperations) => {
      updateUser({ permissions: { ...getDefaultPermissionsByRole('OWNER'), ownerOperations } });
      onClose();
    },
  });
  const close = () => { if (!save.isPending) onClose(); };

  return <Modal open title="Права владельца" onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" disabled={save.isPending} onClick={close}>Отмена</button>
    <button type="submit" form={formId} className="btn-primary btn-md" disabled={save.isPending}>Сохранить</button>
  </div>}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <fieldset disabled={save.isPending} className="divide-y divide-border">
        <legend className="mb-2 text-sm text-text-muted">Действия в заказах и на кассе</legend>
        {operations.map(({ key, label }) => <label key={key} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm">
          <span>{label}</span>
          <input type="checkbox" role="switch" className="h-4 w-4 shrink-0 accent-primary" checked={values[key]}
            onChange={(event) => setValues({ ...values, [key]: event.target.checked })} />
        </label>)}
      </fieldset>
      {save.isError && <p role="alert" className="mt-2 text-sm text-danger">{apiError(save.error)}</p>}
    </form>
  </Modal>;
}
