import { Spinner } from '@/components/Spinner';
import { timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useEffect, useState } from 'react';

export function ShiftCard({ startedAt, busy, onAction, showElapsed = false }: {
  startedAt?: string;
  busy: boolean;
  onAction: () => void;
  showElapsed?: boolean;
}) {
  const t = useT();
  return <section className="card p-5">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[15px] font-semibold text-text-primary">{t('Смена')}</h3>
      {!showElapsed && <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${startedAt ? 'bg-success/10 text-success' : 'bg-background text-text-muted'}`}>
        {t(startedAt ? 'Смена активна' : 'Не начата')}
      </span>}
    </div>
    {startedAt && <div className="mt-4 flex items-center justify-between gap-4 text-sm">
      <span className="text-text-muted">{t('Начало')}</span>
      <span className="font-medium text-text-primary">{timeHM(startedAt)}</span>
    </div>}
    {showElapsed && startedAt ? <button type="button" className="btn-primary btn-lg mt-4 w-full gap-3" disabled={busy} onClick={onAction}>
      {busy ? <Spinner /> : <>
        <span>{t('Закончить')}</span>
        <ShiftElapsed startedAt={startedAt} />
      </>}
    </button> : <button type="button" className="btn-primary btn-lg mt-4 w-full" disabled={busy} onClick={onAction}>
      {busy ? <Spinner /> : t(startedAt ? 'Закончить смену' : 'Начать смену')}
    </button>}
  </section>;
}

function ShiftElapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now);
  const t = useT();
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const duration = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0')).join(':');
  return <span className="tabular-nums font-semibold" aria-label={t('Время в смене')}>
    {duration}
  </span>;
}
