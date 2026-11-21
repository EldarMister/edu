import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { Toggle } from '@/components/Toggle';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { cashShiftKey, financeKey, type CashShift } from '@/features/admin/pages/finance/api';
import { CashOperationDialog } from '@/features/admin/pages/finance/CashOperationDialog';

type CurrentShift = Pick<CashShift, 'id' | 'expectedAmount'>;
type CashShiftState = { enabled: boolean; current: CurrentShift | null };
const key = cashShiftKey;
export function useCashShiftAccess() {
  const { canSection, canEditSection, canAction } = usePermissions();
  const finance = canSection('finance');
  return { canView: finance || canAction('financeCashShifts'),
    canManage: finance ? canEditSection('finance') : canAction('financeCashShifts') };
}
export function useCashShiftState(enabled = true) {
  return useQuery({
    queryKey: key, enabled, retry: false, refetchInterval: 15_000,
    queryFn: async () => (await api.get<CashShiftState>('/cash-shifts')).data,
  });
}

export function CashShiftSettings() {
  const section = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  const query = useCashShiftState();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: async (enabled: boolean) => (await api.patch('/cash-shifts/setting', { enabled })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  useEffect(() => {
    if (hash === '#cash-shift-settings') section.current?.scrollIntoView({ block: 'nearest' });
  }, [hash]);
  return <section ref={section} id="cash-shift-settings" className="card space-y-2 p-5">
    <div className="flex items-center justify-between gap-4">
      <h3 className="font-semibold text-text-primary">Использовать кассовые смены</h3>
      <Toggle ariaLabel="Использовать кассовые смены" checked={query.data?.enabled ?? false}
        disabled={!query.data || change.isPending} onChange={(enabled) => change.mutate(enabled)} />
    </div>
    <p className="text-sm text-text-secondary">При включении для оплаты нужна открытая кассовая смена. Кассир считает наличные в начале и в конце смены.</p>
    {(change.error || query.error) && <p role="alert" className="text-sm text-danger">{apiError(change.error ?? query.error)}</p>}
  </section>;
}

export function CashShiftBanner({ promptOnEntry = false }: { promptOnEntry?: boolean }) {
  const { canView, canManage } = useCashShiftAccess();
  const query = useCashShiftState(canView);
  const [editor, setEditor] = useState<'open' | 'close' | 'operation' | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (!canView || !query.data?.enabled) return null;
  const current = query.data.current;
  const showOpening = canManage && !current && (editor === 'open' || (editor === null && promptOnEntry && !dismissed));
  function closeEditor() {
    setDismissed(true);
    setEditor(null);
  }
  return <>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-sm">
      <span>{current ? <>В кассе по расчёту <strong>{money(current.expectedAmount)}</strong></> : 'Кассовая смена не открыта'}</span>
      {canManage && <div className="flex flex-wrap gap-2">
        {current && <button type="button" className="btn-secondary btn-md" onClick={() => setEditor('operation')}>Операция с наличными</button>}
        <button type="button" className="btn-secondary btn-md" onClick={() => setEditor(current ? 'close' : 'open')}>
          {current ? 'Закрыть кассовую смену' : 'Открыть кассовую смену'}
        </button>
      </div>}
    </div>
    {canManage && editor === 'operation' && current && <CashOperationDialog shiftId={current.id} cashier onClose={() => setEditor(null)} />}
    {showOpening && <CashShiftForm current={null} onClose={closeEditor} />}
    {canManage && editor === 'close' && current && <CashShiftForm key={current.id} current={current} onClose={closeEditor} />}
  </>;
}

export function CashShiftForm({ current, onClose, endpoint = '/cash-shifts', onComplete }: {
  current: CurrentShift | null;
  onClose: () => void;
  endpoint?: string;
  onComplete?: () => void;
}) {
  const form = useId();
  const [amount, setAmount] = useState('');
  const [closingComment, setClosingComment] = useState('');
  const [closeEmployeeShifts, setCloseEmployeeShifts] = useState(false);
  const { canAction } = usePermissions();
  const { canManage } = useCashShiftAccess();
  const mayCloseEmployeeShifts = canAction('closeShift');
  const notify = useNotifications((state) => state.push);
  const qc = useQueryClient();
  const close = !!current;
  const title = close ? 'Закрытие кассовой смены' : 'Открытие кассовой смены';
  const amountLabel = close ? 'Остаток наличных после инкассации' : 'Остаток в кассе';
  const mutate = useMutation({
    mutationFn: async (value: number) => (await api.post<CashShift>(endpoint + (close ? '/close' : '/open'),
      current ? {
        amount: value, shiftId: current.id, expectedAmount: current.expectedAmount,
        closingComment: closingComment.trim() || undefined,
        closeEmployeeShifts: mayCloseEmployeeShifts && closeEmployeeShifts ? true : undefined,
      } : { amount: value })).data,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: financeKey }),
        closeEmployeeShifts && mayCloseEmployeeShifts ? qc.invalidateQueries({ queryKey: ['waiter', 'shift'] }) : undefined,
        closeEmployeeShifts && mayCloseEmployeeShifts ? qc.invalidateQueries({ queryKey: ['staff', 'work-shift'] }) : undefined,
        closeEmployeeShifts && mayCloseEmployeeShifts ? qc.invalidateQueries({ queryKey: ['admin', 'staff'] }) : undefined,
      ]);
      notify({ type: 'success', message: close ? 'Кассовая смена закрыта' : 'Кассовая смена открыта', at: new Date().toISOString() });
      (onComplete ?? onClose)();
    },
    onError: () => { void qc.invalidateQueries({ queryKey: key }); },
  });
  const valid = /^\d+(?:[,.]\d{1,2})?$/.test(amount.trim()) && Number(amount.replace(',', '.')) <= 9999999999.99;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canManage && valid && !mutate.isPending) mutate.mutate(Number(amount.replace(',', '.')));
  }
  if (!canManage) return null;
  return <Modal open title={title} panelClassName="max-w-xl"
    onClose={() => { if (!mutate.isPending) onClose(); }}
    footer={<div className="flex flex-wrap items-center justify-between gap-3">
      <button type="submit" form={form} className="btn-primary btn-md min-w-28" disabled={!valid || mutate.isPending}>
        {close ? 'Закончить' : 'Открыть'}
      </button>
      {close && mayCloseEmployeeShifts && <div className="flex items-center gap-2 text-sm">
        <span>Закрыть смены сотрудников</span>
        <Toggle ariaLabel="Закрыть смены сотрудников" checked={closeEmployeeShifts}
          disabled={mutate.isPending} onChange={setCloseEmployeeShifts} />
      </div>}
    </div>}>
    <form id={form} onSubmit={submit} className="space-y-4 py-2">
      {!close && <p className="rounded-lg bg-background px-3 py-2 text-sm text-text-secondary">
        Пересчитайте наличные в ящике. Если размена нет, введите 0.
      </p>}
      <label className="block text-sm font-medium">
        {amountLabel}
        <input className="input mt-2 h-14 w-full text-lg tabular-nums" autoFocus inputMode="decimal" placeholder="0,00" required
          value={amount} onChange={(event) => setAmount(event.target.value)} disabled={mutate.isPending} />
      </label>
      {current && <>
        <p className="text-sm text-text-secondary">По расчёту в кассе <strong className="text-text-primary">{money(current.expectedAmount)}</strong></p>
        <label className="block text-sm font-medium">Комментарий
          <input className="input mt-2 w-full" value={closingComment} onChange={(event) => setClosingComment(event.target.value)}
            maxLength={500} disabled={mutate.isPending} />
        </label>
        <p className="rounded-lg bg-background px-3 py-2 text-sm text-text-secondary">
          Если забираете выручку, сначала проведите инкассацию. При закрытии укажите сумму, которую оставили в ящике.
        </p>
      </>}
      {mutate.error && <p role="alert" className="text-sm text-danger">{apiError(mutate.error)}</p>}
    </form>
  </Modal>;
}
