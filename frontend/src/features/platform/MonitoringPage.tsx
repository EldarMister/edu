import { Spinner } from '@/components/Spinner';
import { useHealth, useMemory, type AppHealth } from './api';

const STATUS_LABEL: Record<AppHealth['status'], string> = { ok: 'Всё в порядке', warning: 'Предупреждение', degraded: 'Сбой' };
const STATUS_CLASS: Record<AppHealth['status'], string> = {
  ok: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  degraded: 'bg-danger/10 text-danger',
};

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d ? `${d}д` : '', h ? `${h}ч` : '', `${m}м`].filter(Boolean).join(' ');
}

export function MonitoringPage() {
  const health = useHealth();
  const memory = useMemory();

  if (health.isLoading) {
    return <div className="flex justify-center py-16 text-primary"><Spinner className="h-7 w-7" /></div>;
  }
  const h = health.data;
  const m = memory.data;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-text-primary">Мониторинг сервера</h2>

      {h && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold text-text-primary">Состояние</span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASS[h.status]}`}>{STATUS_LABEL[h.status]}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3">
            <Stat label="База данных" value={h.database === 'ok' ? 'OK' : 'Ошибка'} bad={h.database !== 'ok'} />
            <Stat label="Окружение" value={h.env} />
            <Stat label="Версия (commit)" value={h.commit ? h.commit.slice(0, 8) : '—'} />
            <Stat label="Миграции применено" value={`${h.migrations.appliedCount} / ${h.migrations.localCount}`} bad={h.migrations.behind} />
            <Stat label="Отставание" value={h.migrations.behind ? 'есть' : 'нет'} bad={h.migrations.behind} />
            <Stat label="Упавшие миграции" value={h.migrations.failed.length ? String(h.migrations.failed.length) : 'нет'} bad={h.migrations.failed.length > 0} />
          </dl>
          {h.error && <p className="mt-3 rounded-lg bg-danger/5 px-3 py-2 text-xs text-danger">{h.error}</p>}
        </div>
      )}

      {m && (
        <div className="card p-5">
          <span className="text-[15px] font-semibold text-text-primary">Память и аптайм</span>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-4">
            <Stat label="Аптайм" value={fmtUptime(m.uptimeSec)} />
            <Stat label="RSS (биллинг)" value={`${m.rssMb} МБ`} />
            <Stat label="Heap занято" value={`${m.heapUsedMb} МБ`} />
            <Stat label="Heap всего" value={`${m.heapTotalMb} МБ`} />
          </dl>
        </div>
      )}

      <p className="text-xs text-text-muted">Обновляется автоматически каждые 15 секунд.</p>
    </div>
  );
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`mt-0.5 font-medium ${bad ? 'text-danger' : 'text-text-primary'}`}>{value}</dd>
    </div>
  );
}
