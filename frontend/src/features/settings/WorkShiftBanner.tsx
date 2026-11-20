import { createContext, useContext, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import { disconnectSocket, useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import type { WaiterShift } from '@/types';
import { financeKey } from '@/features/admin/pages/finance/api';
import { ShiftRequiredScreen } from '@/features/waiter/ShiftRequiredScreen';
import { ShiftSummaryModal } from '@/features/waiter/ShiftSummaryModal';
import { ShiftCard } from './ShiftCard';
import { useT } from '@/lib/i18n';

type WorkShift = { id: string; startedAt: string; endedAt: string | null; autoCloseAt: string | null };
export const workShiftKey = ['staff', 'work-shift'] as const;
const WorkShiftActions = createContext<{
  startedAt?: string;
  busy: boolean;
  loading: boolean;
  error: unknown;
  retry: () => void;
  act: () => void;
} | null>(null);

export function WorkShiftSettingsCard() {
  const shift = useContext(WorkShiftActions);
  const t = useT();
  if (!shift) return null;
  if (shift.loading) return <section className="card p-5"><Spinner /></section>;
  if (shift.error) return <section className="card space-y-3 p-5">
    <p role="alert" className="text-sm text-danger">{apiError(shift.error)}</p>
    <button type="button" className="btn-secondary btn-md" onClick={shift.retry}>{t('Повторить')}</button>
  </section>;
  return <ShiftCard startedAt={shift.startedAt} busy={shift.busy} onAction={shift.act} showElapsed />;
}

function useWorkShift(includeOwner = false) {
  const user = useAuth((state) => state.user);
  const enabled = !!user && (includeOwner || user.role !== 'OWNER') && user.permissions?.workShiftRequired !== false;
  const queryKey = [...workShiftKey, user?.id];
  const query = useQuery({
    queryKey, enabled, retry: false, refetchInterval: 30_000,
    queryFn: async ({ signal }) => (await api.get<WorkShift | null>('/staff/shifts/current', { signal })).data || null,
  });
  return { enabled, query, queryKey };
}

export function WorkShiftGate({ children, adminWorkspace = false }: { children: ReactNode; adminWorkspace?: boolean }) {
  const { enabled, query, queryKey } = useWorkShift(adminWorkspace);
  const [params] = useSearchParams();
  const isOwner = useAuth((state) => state.user?.role === 'OWNER');
  const profileOpen = adminWorkspace && params.get('section') === 'profile';
  const t = useT();
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [summary, setSummary] = useState<WaiterShift | null>(null);
  const logout = useAuth((state) => state.logout);
  const notify = useNotifications((state) => state.push);
  const refresh = () => { if (enabled) void qc.invalidateQueries({ queryKey: workShiftKey }); };
  useSocketEvent('waiter:shift_started', refresh);
  useSocketEvent('waiter:shift_ended', refresh);
  const start = useMutation({
    mutationFn: async () => (await api.post<WorkShift>('/staff/shifts/start')).data,
    onSuccess: async (shift) => {
      await qc.cancelQueries({ queryKey, exact: true });
      qc.setQueryData(queryKey, shift);
      void qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
    onError: refresh,
  });
  const end = useMutation({
    mutationFn: async () => (await api.post<WaiterShift>('/staff/shifts/end')).data,
    onSuccess: async (shift) => {
      await qc.cancelQueries({ queryKey, exact: true });
      setSummary(shift);
      qc.setQueryData(queryKey, null);
      void qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
      void qc.invalidateQueries({ queryKey: financeKey });
    },
    onError: (err) => {
      notify({ message: apiError(err), type: 'error', at: new Date().toISOString() });
      refresh();
    },
  });
  if (!enabled) return <>{children}</>;
  const current = query.data?.endedAt ? null : query.data;
  // Keep settings mounted while the end request and its summary are on screen.
  if (!starting && (current || end.isPending || summary || profileOpen || (adminWorkspace && isOwner))) {
    return <WorkShiftActions.Provider value={{
      startedAt: current?.startedAt ?? summary?.startedAt,
      busy: start.isPending || end.isPending || !!summary,
      loading: query.isPending,
      error: query.data === undefined ? query.error : null,
      retry: () => void query.refetch(),
      act: () => {
        if (current) end.mutate();
        else start.mutate(undefined, {
          onError: (err) => notify({ message: apiError(err), type: 'error', at: new Date().toISOString() }),
        });
      },
    }}>
      {children}
      <ShiftSummaryModal shift={summary} open={!!summary} onClose={() => setSummary(null)} />
    </WorkShiftActions.Provider>;
  }

  return <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-white">
    <div className="flex shrink-0 justify-end gap-2 px-4 pt-3">
      {adminWorkspace && !starting && <Link to="?section=profile" state={{ returnFromProfile: true }} className="btn-secondary btn-md">{t('Личный кабинет')}</Link>}
      <button type="button" className="btn-secondary btn-md" onClick={() => { disconnectSocket(); logout(); }}>{t('Выйти')}</button>
    </div>
    <div className="min-h-[420px] flex-1">
      {starting || (!query.isPending && !query.isError) ? (
        <ShiftRequiredScreen onBusyChange={setStarting} startShift={() => start.mutateAsync()} idleSubtitle="Начните смену, чтобы приступить к работе." />
      ) : <div className="grid h-full place-content-center justify-items-center gap-4 px-4 text-center">
        {query.isPending ? <Spinner /> : <>
          <p role="alert">{apiError(query.error)}</p>
          <button type="button" className="btn-secondary btn-md" onClick={() => void query.refetch()}>Повторить</button>
        </>}
      </div>}
    </div>
  </main>;
}

/** Own work time is independent of cash register shifts. */
export function WorkShiftBanner() {
  const { enabled, query, queryKey } = useWorkShift();
  const qc = useQueryClient();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const change = useMutation({
    mutationFn: () => api.post<WorkShift>('/staff/shifts/end'),
    onSuccess: async () => {
      setConfirmEnd(false);
      qc.setQueryData(queryKey, null);
      await Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'staff'] }), qc.invalidateQueries({ queryKey: financeKey })]);
    },
    onError: () => void qc.invalidateQueries({ queryKey: workShiftKey }),
  });
  const current = query.data;
  if (!enabled || !current || current.endedAt) return null;
  const time = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' });
  return <>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-sm">
      <div>
        <p className="font-medium">Рабочая смена с {time(current.startedAt)}</p>
        <p className="text-xs text-text-muted">Время учитывается для табеля и расчёта зарплаты.</p>
        {current.autoCloseAt && <p className="text-xs text-text-muted">Автозавершение через 20 часов после начала: {time(current.autoCloseAt)}.</p>}
      </div>
      <button type="button" className="btn-secondary btn-md" disabled={change.isPending}
        onClick={() => { change.reset(); setConfirmEnd(true); }}>Завершить рабочую смену</button>
    </div>
    {confirmEnd && <Modal open title="Завершить рабочую смену?" onClose={() => { if (!change.isPending) setConfirmEnd(false); }}
      footer={<button className="btn-primary btn-md" disabled={change.isPending} onClick={() => change.mutate()}>Завершить смену</button>}>
      <p>Рабочее время с {time(current.startedAt)} будет сохранено в табеле. При следующем выходе на работу начните новую смену.</p>
      {change.error && <p role="alert" className="mt-3 text-danger">{apiError(change.error)}</p>}
    </Modal>}
  </>;
}
