import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { api, apiError } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { financeKey } from '@/features/admin/pages/finance/api';

type WorkShift = { id: string; startedAt: string; endedAt: string | null; autoCloseAt: string | null };
export const workShiftKey = ['staff', 'work-shift'] as const;

/** Own work time is independent of cash register shifts and back-office access. */
export function WorkShiftBanner() {
  const user = useAuth((state) => state.user);
  const enabled = !!user && user.role !== 'OWNER';
  const qc = useQueryClient();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const query = useQuery({
    queryKey: [...workShiftKey, user?.id], enabled, retry: false, refetchInterval: 30_000,
    queryFn: async () => (await api.get<WorkShift | null>('/staff/shifts/current')).data,
  });
  const refresh = () => { if (enabled) void qc.invalidateQueries({ queryKey: workShiftKey }); };
  useSocketEvent('waiter:shift_started', refresh);
  useSocketEvent('waiter:shift_ended', refresh);
  const change = useMutation({
    mutationFn: async (action: 'start' | 'end') => (await api.post<WorkShift>(`/staff/shifts/${action}`)).data,
    onSuccess: async () => {
      setConfirmEnd(false);
      await Promise.all([qc.invalidateQueries({ queryKey: workShiftKey }),
        qc.invalidateQueries({ queryKey: ['admin', 'staff'] }), qc.invalidateQueries({ queryKey: financeKey })]);
    },
    onError: refresh,
  });
  if (!enabled) return null;
  const current = query.data;
  const started = current && !current.endedAt;
  const time = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' });
  return <>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-sm">
      <div>
        <p className="font-medium">{query.isPending ? 'Загрузка рабочей смены…' : started
          ? `Рабочая смена с ${time(current.startedAt)}` : 'Рабочая смена не начата'}</p>
        <p className="text-xs text-text-muted">{started
          ? 'Время учитывается для табеля и расчёта зарплаты.' : 'Начните смену, чтобы учитывать рабочее время.'}</p>
        {started && current.autoCloseAt && <p className="text-xs text-text-muted">Автозавершение через 20 часов после начала: {time(current.autoCloseAt)}.</p>}
        {(query.error || change.error) && <p role="alert" className="mt-1 text-xs text-danger">{apiError(change.error ?? query.error)}</p>}
      </div>
      {query.isError ? <button className="btn-secondary btn-md" onClick={() => query.refetch()}>Повторить</button>
        : <button type="button" className="btn-secondary btn-md" disabled={query.isPending || change.isPending}
          onClick={() => { change.reset(); if (started) setConfirmEnd(true); else change.mutate('start'); }}>
          {change.isPending ? 'Сохранение…' : started ? 'Завершить рабочую смену' : 'Начать рабочую смену'}
        </button>}
    </div>
    {confirmEnd && started && <Modal open title="Завершить рабочую смену?" onClose={() => { if (!change.isPending) setConfirmEnd(false); }}
      footer={<button className="btn-primary btn-md" disabled={change.isPending} onClick={() => change.mutate('end')}>Завершить смену</button>}>
      <p>Рабочее время с {time(current.startedAt)} будет сохранено в табеле. При следующем выходе на работу начните новую смену.</p>
      {change.error && <p role="alert" className="mt-3 text-danger">{apiError(change.error)}</p>}
    </Modal>}
  </>;
}
