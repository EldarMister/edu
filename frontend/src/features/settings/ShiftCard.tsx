import { Spinner } from '@/components/Spinner';
import { timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';

export function ShiftCard({ startedAt, busy, onAction }: {
  startedAt?: string;
  busy: boolean;
  onAction: () => void;
}) {
  const t = useT();
  return <section className="card p-5">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[15px] font-semibold text-text-primary">{t('Смена')}</h3>
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${startedAt ? 'bg-success/10 text-success' : 'bg-background text-text-muted'}`}>
        {t(startedAt ? 'Смена активна' : 'Не начата')}
      </span>
    </div>
    {startedAt && <div className="mt-4 flex items-center justify-between gap-4 text-sm">
      <span className="text-text-muted">{t('Начало')}</span>
      <span className="font-medium text-text-primary">{timeHM(startedAt)}</span>
    </div>}
    <button type="button" className="btn-primary btn-lg mt-4 w-full" disabled={busy} onClick={onAction}>
      {busy ? <Spinner /> : t(startedAt ? 'Закончить смену' : 'Начать смену')}
    </button>
  </section>;
}
