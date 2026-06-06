import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';

const REASONS = ['Клиент передумал', 'Ошибка официанта', 'Долгое ожидание', 'Другая причина'];

/** Модалка отмены заказа с обязательной причиной (попадает в audit metadata). */
export function CancelOrderModal({
  open,
  orderLabel,
  submitting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  orderLabel: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [comment, setComment] = useState('');
  const isOther = reason === 'Другая причина';
  const finalReason = isOther ? comment.trim() : reason;
  const valid = !isOther || comment.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Отменить заказ?"
      footer={
        <div className="flex gap-2">
          <button className="btn-secondary btn-lg flex-1" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-danger btn-lg flex-1 font-semibold"
            disabled={!valid || submitting}
            onClick={() => onConfirm(finalReason)}
          >
            {submitting ? <Spinner /> : 'Отменить заказ'}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-text-secondary">{orderLabel}</p>
      <p className="mb-2 text-sm font-medium text-text-secondary">Причина отмены</p>
      <div className="space-y-2">
        {REASONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={`flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[15px] transition-colors ${
              reason === r
                ? 'border-primary bg-primary/5 text-text-primary'
                : 'border-border text-text-secondary hover:border-primary/40'
            }`}
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                reason === r ? 'border-primary' : 'border-text-light'
              }`}
            >
              {reason === r && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            {r}
          </button>
        ))}
      </div>

      {isOther && (
        <textarea
          className="input mt-3 h-20 resize-none py-2.5"
          placeholder="Опишите причину…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoFocus
        />
      )}
    </Modal>
  );
}
