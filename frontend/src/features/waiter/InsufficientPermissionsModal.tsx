import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { useT } from '@/lib/i18n';

export function InsufficientPermissionsModal({
  open,
  onClose,
  onCallAdministrator,
  submitting = false,
  itemName,
  onRequestCancellation,
  requestError,
}: {
  open: boolean;
  onClose: () => void;
  onCallAdministrator: () => void;
  submitting?: boolean;
  itemName?: string;
  onRequestCancellation?: (reason: string) => void;
  requestError?: string;
}) {
  const t = useT();
  const [reason, setReason] = useState('');

  return (
    <Modal open={open} onClose={onClose} panelClassName="max-w-lg overflow-hidden">
      <div className="flex flex-col items-center px-2 pb-2 pt-3 text-center sm:px-8 sm:pb-5 sm:pt-5">
        <img
          src="/chef-no-no-loop.webp"
          width={640}
          height={788}
          className="h-auto max-h-[min(260px,36dvh)] w-auto max-w-full object-contain"
          fetchPriority="high"
          alt=""
        />
        <h2 className="mt-2 text-[28px] font-bold tracking-tight text-text-primary sm:text-[32px]">
          {t('Недостаточно прав')}
        </h2>
        <p className="mt-3 max-w-sm text-[17px] leading-7 text-text-secondary sm:text-lg">
          {itemName ? t('Отмену блюда подтверждает администратор') + ' · ' + itemName
            : t('У вас недостаточно прав для отмены заказа. Пожалуйста, позовите администратора.')}
        </p>
        <div className="mt-7 w-full space-y-3">
          {onRequestCancellation && <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            if (!submitting && reason.trim().length >= 2) onRequestCancellation(reason.trim());
          }}>
            <label className="block space-y-1 text-left text-sm text-text-secondary">
              <span>{t('Причина отмены')}</span>
              <input className="input w-full" value={reason} required minLength={2} maxLength={160}
                onChange={(event) => setReason(event.target.value)} disabled={submitting} />
            </label>
            {requestError && <p role="alert" className="text-sm text-danger">{requestError}</p>}
            <button type="submit" className="btn-primary btn-lg w-full" disabled={submitting || reason.trim().length < 2}>
              {t('Отправить заявку на отмену')}
            </button>
          </form>}
          <button
            type="button"
            className={`${onRequestCancellation ? 'btn-secondary' : 'btn-primary'} btn-lg w-full text-base font-semibold`}
            disabled={submitting}
            onClick={onCallAdministrator}
          >
            {t('Позвать администратора')}
          </button>
          <button
            type="button"
            className="btn btn-lg w-full border border-primary bg-white text-base font-semibold text-primary hover:bg-primary/5"
            disabled={submitting}
            onClick={onClose}
          >
            {t('Понятно')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
