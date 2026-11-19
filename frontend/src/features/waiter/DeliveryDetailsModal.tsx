import { useId } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { useT } from '@/lib/i18n';
import type { DeliveryDetails } from './api';

export function DeliveryDetailsModal({
  details,
  error,
  pending,
  onChange,
  onClose,
  onSubmit,
}: {
  details: DeliveryDetails;
  error: string;
  pending: boolean;
  onChange: (details: DeliveryDetails) => void;
  onClose: () => void;
  onSubmit: (details: DeliveryDetails) => void;
}) {
  const t = useT();
  const formId = useId();
  function close() {
    if (!pending) onClose();
  }

  return (
    <Modal open onClose={close} title={t('Данные доставки')} footer={
      <div className="flex gap-2">
        <button type="button" className="btn-secondary btn-lg flex-1" disabled={pending} onClick={close}>
          {t('Назад')}
        </button>
        <button type="submit" form={formId} className="btn-primary btn-lg flex-1 font-semibold" disabled={pending}>
          {pending ? <Spinner /> : t('Оформить доставку')}
        </button>
      </div>
    }>
      <form id={formId} className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        if (!pending) onSubmit({
          customerName: details.customerName.trim(),
          customerPhone: details.customerPhone.trim(),
          deliveryAddress: details.deliveryAddress.trim(),
        });
      }}>
        <label className="block space-y-1 text-sm font-medium">
          <span>{t('Имя клиента')}</span>
          <input className="input" maxLength={120} value={details.customerName} disabled={pending}
            onChange={(event) => onChange({ ...details, customerName: event.target.value })} />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          <span>{t('Телефон клиента')}</span>
          <input className="input" type="tel" required maxLength={40} value={details.customerPhone}
            disabled={pending} onChange={(event) => onChange({ ...details, customerPhone: event.target.value })} />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          <span>{t('Адрес доставки')}</span>
          <textarea className="input min-h-20 resize-y py-2.5" required maxLength={300} value={details.deliveryAddress}
            disabled={pending} onChange={(event) => onChange({ ...details, deliveryAddress: event.target.value })} />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
}
