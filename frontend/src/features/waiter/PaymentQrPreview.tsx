import { useT } from '@/lib/i18n';

export function PaymentQrPreview({ url }: { url: string }) {
  const t = useT();
  return <details className="mt-3 rounded-lg border border-border px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium text-primary">{t('Показать QR-код для оплаты')}</summary>
    <img src={url} alt={t('QR-код для оплаты')} className="mx-auto mt-3 size-48 max-w-full rounded-md bg-paper object-contain p-2" />
  </details>;
}
