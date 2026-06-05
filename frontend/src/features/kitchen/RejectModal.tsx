import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { REJECT_REASONS } from '@/lib/status';

export function RejectModal({
  open,
  title,
  submitting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string, comment?: string) => void;
}) {
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [comment, setComment] = useState('');
  const isOther = reason === 'Другая причина';
  const valid = !isOther || comment.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <button className="btn-secondary btn-lg flex-1" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-danger btn-lg flex-1 font-semibold"
            disabled={!valid || submitting}
            onClick={() => onConfirm(reason, isOther ? comment.trim() : undefined)}
          >
            {submitting ? <Spinner /> : 'Подтвердить отказ'}
          </button>
        </div>
      }
    >
      <p className="mb-2 text-sm font-medium text-text-secondary">Причина отказа</p>
      <div className="space-y-2">
        {REJECT_REASONS.map((r) => (
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
