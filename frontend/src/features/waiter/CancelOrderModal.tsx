import { useEffect, useState } from 'react';
import type { Order } from '@/types';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { displayOrderNumber, hallSuffix } from '@/lib/format';
import { useT } from '@/lib/i18n';

const REASONS = ['Клиент передумал', 'Ошибка официанта', 'Другое'] as const;

/**
 * Подтверждение отмены заказа с выбором причины.
 * `accepted` — кухня уже приняла заказ: тогда это запрос на отмену (Фаза 2),
 * иначе — прямая отмена.
 */
export function CancelOrderModal({
  open,
  order,
  accepted = false,
  submitting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  order: Order | null;
  accepted?: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [other, setOther] = useState('');

  useEffect(() => {
    if (open) {
      setReason(REASONS[0]);
      setOther('');
    }
  }, [open]);

  if (!order) return null;

  const finalReason = reason === 'Другое' ? other.trim() || 'Другое' : reason;
  const title = accepted ? t('Запросить отмену заказа?') : t('Отменить заказ?');
  const text = accepted
    ? 'Кухня уже приняла заказ. Отмена будет выполнена только после подтверждения кухни.'
    : 'Заказ ещё не принят кухней, поэтому он будет отменён сразу.';
  const confirmLabel = accepted ? t('Запросить отмену') : t('Отменить заказ');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <button className="btn-secondary btn-lg flex-1" disabled={submitting} onClick={onClose}>
            {t('Назад')}
          </button>
          <button
            className={`btn-lg flex-1 font-semibold ${accepted ? 'btn-primary' : 'btn-danger'}`}
            disabled={submitting}
            onClick={() => onConfirm(finalReason)}
          >
            {submitting ? <Spinner /> : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="mb-1 text-sm text-text-muted">{displayOrderNumber(order.orderNumber)} · {t('Стол')} {order.table.number}{hallSuffix(order.table)}</p>
      <p className="mb-4 text-sm text-text-secondary">{t(text)}</p>

      <p className="mb-2 text-sm font-medium text-text-secondary">{t('Причина')}</p>
      <div className="space-y-2">
        {REASONS.map((r) => (
          <label
            key={r}
            className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[15px] transition-colors ${
              reason === r ? 'border-primary bg-primary/5 text-text-primary' : 'border-border text-text-secondary'
            }`}
          >
            <input
              type="radio"
              name="cancel-reason"
              className="accent-primary"
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {t(r)}
          </label>
        ))}
      </div>
      {reason === 'Другое' && (
        <input
          className="input mt-2"
          placeholder={t('Укажите причину')}
          value={other}
          autoFocus
          onChange={(e) => setOther(e.target.value)}
        />
      )}
    </Modal>
  );
}
