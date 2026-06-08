import type { WaiterShift } from '@/types';
import { Modal } from '@/components/Modal';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';

/** Дата и время: «08.06.2026 15:30». */
function dateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Длительность между двумя моментами: «3 ч 25 мин». */
function duration(startIso: string, endIso: string, t: (s: string) => string): string {
  const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} ${t('мин')}`;
  return `${h} ${t('ч')} ${m} ${t('мин')}`;
}

/** Итоги смены официанта после её завершения. */
export function ShiftSummaryModal({
  shift,
  open,
  onClose,
}: {
  shift: WaiterShift | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  if (!shift) return null;

  const rows: { label: string; value: string }[] = [
    { label: t('Начало смены'), value: dateTime(shift.startedAt) },
    { label: t('Конец смены'), value: shift.endedAt ? dateTime(shift.endedAt) : '—' },
    {
      label: t('Отработано'),
      value: shift.endedAt ? duration(shift.startedAt, shift.endedAt, t) : '—',
    },
    { label: t('Закрыто заказов'), value: String(shift.stats?.ordersCount ?? 0) },
    { label: t('Сумма'), value: money(shift.stats?.totalAmount ?? 0) },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Смена завершена')}
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" onClick={onClose}>
          {t('Готово')}
        </button>
      }
    >
      <div className="mb-4 flex flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <p className="mt-3 text-sm text-text-muted">{t('Спасибо за работу!')}</p>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-text-muted">{r.label}</span>
            <span className="font-medium text-text-primary">{r.value}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
