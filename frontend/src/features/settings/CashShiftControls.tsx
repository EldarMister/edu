import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { Toggle } from '@/components/Toggle';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { cashShiftKey, financeKey } from '@/features/admin/pages/finance/api';
import { CashOperationDialog } from '@/features/admin/pages/finance/CashOperationDialog';

type CurrentShift = { id: string; openingAmount: number; expectedAmount: number };
type CashShiftState = { enabled: boolean; current: CurrentShift | null };
const key = cashShiftKey;
function useCashShiftState(enabled = true) {
  return useQuery({
    queryKey: key, enabled, retry: false, refetchInterval: 15_000,
    queryFn: async () => (await api.get<CashShiftState>('/cash-shifts')).data,
  });
}

export function CashShiftSettings() {
  const query = useCashShiftState();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: async (enabled: boolean) => (await api.patch('/cash-shifts/setting', { enabled })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return <section className="card space-y-2 p-5">
    <div className="flex items-center justify-between gap-4">
      <h3 className="font-semibold text-text-primary">Использовать кассовые смены</h3>
      <Toggle ariaLabel="Использовать кассовые смены" checked={query.data?.enabled ?? false}
        disabled={!query.data || change.isPending} onChange={(enabled) => change.mutate(enabled)} />
    </div>
    <p className="text-sm text-text-secondary">Кассир вводит размен при открытии и пересчитывает наличные при закрытии.</p>
    {(change.error || query.error) && <p role="alert" className="text-sm text-danger">{apiError(change.error ?? query.error)}</p>}
  </section>;
}

export function CashShiftBanner() {
  const { canAction } = usePermissions();
  const query = useCashShiftState(canAction('financeCashShifts'));
  const [editor, setEditor] = useState<'open' | 'close' | 'operation' | null>(null);
  if (!query.data?.enabled) return null;
  const current = query.data.current;
  return <>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-sm">
      <span>{current ? <>Остаток в кассе <strong>{money(current.expectedAmount)}</strong></> : 'Кассовая смена ещё не открыта'}</span>
      <div className="flex flex-wrap gap-2">
        {current && <button type="button" className="btn-secondary btn-md" onClick={() => setEditor('operation')}>Создать транзакцию</button>}
        <button type="button" className="btn-secondary btn-md" onClick={() => setEditor(current ? 'close' : 'open')}>
          {current ? 'Закрыть кассовую смену' : 'Открыть кассовую смену'}
        </button>
      </div>
    </div>
    {editor === 'operation' && current && <CashOperationDialog shiftId={current.id} cashier onClose={() => setEditor(null)} />}
    {(editor === 'open' || (editor === 'close' && current))
      && <CashShiftForm current={editor === 'close' ? current : null} onClose={() => setEditor(null)} />}
  </>;
}

function CashShiftForm({ current, onClose }: { current: CurrentShift | null; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const qc = useQueryClient();
  const close = !!current;
  const title = close ? 'Закрыть кассовую смену' : 'Открыть кассовую смену';
  const mutate = useMutation({
    mutationFn: async (value: number) => (await api.post('/cash-shifts/' + (close ? 'close' : 'open'),
      current ? { amount: value, shiftId: current.id, expectedAmount: current.expectedAmount } : { amount: value })).data,
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: financeKey })]);
      onClose();
    },
    onError: () => { void qc.invalidateQueries({ queryKey: key }); },
  });
  const valid = /^\d+(?:[,.]\d{1,2})?$/.test(amount.trim()) && Number(amount.replace(',', '.')) <= 9999999999.99;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !mutate.isPending) mutate.mutate(Number(amount.replace(',', '.')));
  }
  return <Modal open title={title} onClose={() => { if (!mutate.isPending) onClose(); }}>
    <form onSubmit={submit} className="space-y-4">
      {current && <p className="text-sm text-text-secondary">Книжный баланс {money(current.expectedAmount)}</p>}
      <label className="block text-sm">
        {close ? 'Наличные, оставленные в кассе' : 'Остаток в кассе'}
        <input className="input mt-2 w-full" autoFocus inputMode="decimal" required
          value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      {mutate.error && <p role="alert" className="text-sm text-danger">{apiError(mutate.error)}</p>}
      <button type="submit" className="btn-primary btn-md w-full" disabled={!valid || mutate.isPending}>
        {close ? 'Закрыть смену' : 'Открыть смену'}
      </button>
    </form>
  </Modal>;
}
