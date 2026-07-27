import { Modal } from '@/components/Modal';
import { useT } from '@/lib/i18n';

export function InsufficientPermissionsModal({
  open,
  onClose,
  onCallAdministrator,
  submitting = false,
}: {
  open: boolean;
  onClose: () => void;
  onCallAdministrator: () => void;
  submitting?: boolean;
}) {
  const t = useT();

  return (
    <Modal open={open} onClose={onClose} panelClassName="max-w-lg overflow-hidden">
      <div className="flex flex-col items-center px-2 pb-2 pt-3 text-center sm:px-8 sm:pb-5 sm:pt-5">
        <img
          src="/insufficient-permissions.png"
          width={738}
          height={517}
          className="h-auto w-full max-w-[300px] object-contain sm:max-w-[330px]"
          alt=""
        />
        <h2 className="mt-2 text-[28px] font-bold tracking-tight text-text-primary sm:text-[32px]">
          {t('Недостаточно прав')}
        </h2>
        <p className="mt-3 max-w-sm text-[17px] leading-7 text-text-secondary sm:text-lg">
          {t('У вас недостаточно прав для отмены заказа. Пожалуйста, позовите администратора.')}
        </p>
        <div className="mt-7 w-full space-y-3">
          <button
            type="button"
            className="btn-primary btn-lg w-full text-base font-semibold"
            disabled={submitting}
            onClick={onCallAdministrator}
          >
            {submitting ? t('Отправляем вызов…') : t('Позвать администратора')}
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
