import { useRef, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { IconQr, IconTrash } from '../admin/components/icons';
import { useUpdateSettings } from './api';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 2 * 1024 * 1024; // 2 МБ

export function QrPaymentCard({ qrImageUrl }: { qrImageUrl: string | null }) {
  const t = useT();
  const update = useUpdateSettings();
  const push = useNotifications((s) => s.push);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function pick() {
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяем выбрать тот же файл повторно
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      push({ message: 'Поддерживаются только PNG, JPG или WEBP', type: 'error', at: new Date().toISOString() });
      return;
    }
    if (file.size > MAX_BYTES) {
      push({ message: 'Файл слишком большой (макс. 2 МБ)', type: 'error', at: new Date().toISOString() });
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      await update.mutateAsync({ qrImageUrl: dataUrl });
      push({ message: 'QR-код сохранён', type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await update.mutateAsync({ qrImageUrl: '' });
      push({ message: 'QR-код удалён', type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }

  const hasQr = !!qrImageUrl;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <IconQr className="h-5 w-5 text-text-secondary" />
        <h3 className="text-[15px] font-semibold text-text-primary">{t('QR-оплата')}</h3>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${
            hasQr ? 'bg-success/10 text-success' : 'bg-background text-text-muted'
          }`}
        >
          {hasQr ? t('QR-код загружен') : t('Не загружен')}
        </span>
      </div>

      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} />

      {hasQr ? (
        <div className="flex items-center gap-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-1.5">
            <img src={qrImageUrl} alt="QR" className="h-full w-full object-contain" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-xs text-text-muted">
              {t('Этот QR-код увидят официанты на экране оплаты.')}
            </p>
            <div className="flex gap-2">
              <button className="btn-secondary btn-md flex-1" onClick={pick} disabled={busy}>
                {busy ? <Spinner /> : t('Изменить')}
              </button>
              <button
                className="btn-danger btn-md flex-1"
                onClick={onDelete}
                disabled={busy}
              >
                <IconTrash className="h-4 w-4" />
                {t('Удалить')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-4 text-center">
          <p className="mb-3 text-xs text-text-muted">
            {t('Загрузите QR-код для приёма оплаты. PNG, JPG или WEBP до 2 МБ.')}
          </p>
          <button className="btn-primary btn-md mx-auto px-5" onClick={pick} disabled={busy}>
            {busy ? <Spinner /> : t('Загрузить QR-код')}
          </button>
        </div>
      )}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}
