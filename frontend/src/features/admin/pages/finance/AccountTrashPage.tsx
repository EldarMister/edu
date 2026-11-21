import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { EditorPage } from '../warehouse/EditorPage';
import { QueryState } from '../warehouse/WarehouseUi';
import { FinanceRegister } from './FinanceRegister';
import { financeDateTime, financeMoney } from './finance-format';
import { useFinanceWrites, useTrashedFinanceAccounts, type FinanceAccount } from './api';

export function AccountTrashPage({ onClose }: { onClose: () => void }) {
  const accounts = useTrashedFinanceAccounts();
  const { restoreAccount } = useFinanceWrites();
  return <EditorPage title="Корзина счетов" onClose={onClose}>
    {accounts.data ? <>
      <FinanceRegister title="Удалённые счета" filters={null} reportActions={false}
        columns={[
          { key: 'name', label: 'Название', width: '37%' },
          { key: 'type', label: 'Тип', width: '23%' },
          { key: 'balance', label: 'Баланс', numeric: true },
          { key: 'removed', label: 'Дата удаления' },
        ]}
        rows={accounts.data.map((account) => ({ id: account.id, values: {
          name: { value: account.name },
          type: { value: account.type === 'cash' ? 'Наличные' : 'Безналичный счёт' },
          balance: { value: account.balance, display: financeMoney(account.balance) },
          removed: { value: financeDateTime(account.archivedAt) },
        }, action: <button type="button" className="text-primary hover:underline" disabled={restoreAccount.isPending}
          aria-label={'Восстановить ' + account.name} onClick={() => restoreAccount.mutate(account.id)}>Восстановить</button> }))}
        empty="Корзина счетов пуста" />
      {restoreAccount.error && <p role="alert" className="px-3 py-2 text-danger">{apiError(restoreAccount.error)}</p>}
    </> : <QueryState pending={accounts.isPending} error={accounts.error} />}
  </EditorPage>;
}

export function ArchiveAccountDialog({ account, onClose }: { account: FinanceAccount; onClose: () => void }) {
  const { archiveAccount } = useFinanceWrites();
  const close = () => { if (!archiveAccount.isPending) onClose(); };
  return <Modal open title="Удаление счёта" onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" onClick={close} disabled={archiveAccount.isPending}>Отмена</button>
    <button type="button" className="btn-danger btn-md" disabled={archiveAccount.isPending}
      onClick={() => archiveAccount.mutate(account.id, { onSuccess: onClose })}>Удалить</button>
  </div>}>
    <div className="space-y-3">
      <p>Удалить счёт «{account.name}»?</p>
      <p className="text-text-secondary">Счёт и его транзакции будут перемещены в корзину. Их можно восстановить в течение 30 дней.</p>
      {archiveAccount.error && <p role="alert" className="text-danger">{apiError(archiveAccount.error)}</p>}
    </div>
  </Modal>;
}
