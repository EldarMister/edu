import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { readAsDataUrl } from '@/lib/image';
import { DEFAULT_RECEIPT_TEXT, formatReceiptPhones, receiptFooterText, receiptPrintSettings } from '@/lib/receipt';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import type { ReceiptPrintSettings } from '@/types';
import { WorkspacePending } from '../admin/components/WorkspacePending';
import { useAdminSettings, useUpdateSettings, type Settings } from './api';

const RECEIPT_LIMIT = 120;
const logoTypes = ['image/png', 'image/jpeg', 'image/webp'];
const logoLimit = 500 * 1024;

function receiptForm(settings: Settings) {
  return {
    ...receiptPrintSettings(settings),
    receiptText: settings.receiptText ?? DEFAULT_RECEIPT_TEXT,
    receiptLogoData: settings.receiptLogoData ?? '',
    receiptPrintRequestsOnly: settings.receiptPrintRequestsOnly ?? false,
  };
}

type ReceiptForm = ReturnType<typeof receiptForm>;
type HeaderFlag = Exclude<keyof ReceiptPrintSettings, 'receiptLanguage'>;

export function ReceiptSettingsPage() {
  const t = useT();
  const { isOwner, canEditSection } = usePermissions();
  const editable = canEditSection('settings');
  const { data, isPending, error } = useAdminSettings();
  const update = useUpdateSettings();
  const push = useNotifications((state) => state.push);
  const [changes, setChanges] = useState<Partial<ReceiptForm>>({});
  const [saveError, setSaveError] = useState('');
  const [readingLogo, setReadingLogo] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const dirty = Object.keys(changes).length > 0;
  const { markSaved } = useEditorDirty(editable && dirty);
  const busy = update.isPending || readingLogo;

  if (isPending) return <WorkspacePending />;
  if (error || !data) return <p role="alert" className="text-sm text-danger">{apiError(error)}</p>;

  const saved = receiptForm(data);
  const form = { ...saved, ...changes };
  const footerText = receiptFooterText(form.receiptText, form.receiptLanguage);
  const headerFields: { key: HeaderFlag; label: string; value: string }[] = [
    { key: 'receiptPrintCafeName', label: 'Печатать название заведения', value: data.cafeName },
    { key: 'receiptPrintAddress', label: 'Печатать адрес', value: data.address },
    { key: 'receiptPrintPhone', label: 'Печатать телефон для связи', value: formatReceiptPhones(data.phone, data.phone2) },
  ];

  function set<K extends keyof ReceiptForm>(key: K, value: ReceiptForm[K]) {
    setSaveError('');
    setChanges((current) => {
      const next = { ...current };
      if (value === saved[key]) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!logoTypes.includes(file.type) || file.size > logoLimit) {
      setSaveError(t('Загрузите PNG, JPG или WEBP размером до 500 КБ.'));
      return;
    }
    setReadingLogo(true);
    try {
      set('receiptLogoData', await readAsDataUrl(file));
    } catch (failure) {
      setSaveError(apiError(failure));
    } finally {
      setReadingLogo(false);
    }
  }

  async function save() {
    if (!editable || busy || !dirty) return;
    setSaveError('');
    try {
      await update.mutateAsync(changes);
      markSaved();
      setChanges({});
      push({ message: t('Настройки сохранены'), type: 'success', at: new Date().toISOString() });
    } catch (failure) {
      setSaveError(apiError(failure));
    }
  }

  return (
    <form className="workspace-stagger max-w-3xl space-y-4" onSubmit={(event) => {
      event.preventDefault();
      void save();
    }}>
      {!editable && <p className="text-sm text-text-muted">{t('Настройки доступны только для просмотра.')}</p>}
      <fieldset disabled={!editable || busy} className="min-w-0">
        <section className="card space-y-4 p-5">
          <label className="grid gap-1.5 text-sm font-medium text-text-secondary">
            {t('Язык чека')}
            <select className="input w-full" value={form.receiptLanguage} aria-label={t('Язык чека')}
              onChange={(event) => set('receiptLanguage', event.target.value === 'ky' ? 'ky' : 'ru')}>
              <option value="ru">Русский</option>
              <option value="ky">Кыргызча</option>
            </select>
          </label>

          <div className="space-y-3 border-y border-border py-4">
            <h2 className="font-semibold text-text-primary">{t('Реквизиты для товарного чека и счёта')}</h2>
            {headerFields.map(({ key, label, value }) => (
              <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" aria-label={t(label)}
                  checked={form[key]} onChange={(event) => set(key, event.target.checked)} />
                <span>
                  {t(label)}
                  <span className="mt-0.5 block break-words text-xs text-text-muted">{value || t('Не указано')}</span>
                </span>
              </label>
            ))}
            {editable && <Link className="text-sm text-primary hover:underline" to="?section=settings&view=general">
              {t('Заполнить реквизиты')}
            </Link>}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-medium text-text-secondary">{t('Логотип на чеке')}</h2>
            {form.receiptLogoData && <img className="max-h-20 max-w-full rounded-md bg-[#fff] p-2 object-contain"
              src={form.receiptLogoData} alt={t('Логотип на чеке')} />}
            <input ref={logoInput} type="file" aria-label={t('Загрузить логотип')} className="hidden"
              accept={logoTypes.join(',')} onChange={chooseLogo} />
            {editable && <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary btn-md" onClick={() => logoInput.current?.click()}>
                {t('Загрузить логотип')}
              </button>
              {form.receiptLogoData && <button type="button" className="btn-ghost btn-md" onClick={() => set('receiptLogoData', '')}>
                {t('Удалить логотип')}
              </button>}
            </div>}
          </div>

          <label className="grid gap-1.5 text-sm font-medium text-text-secondary">
            {t('Текст в чеке')}
            <textarea className="input min-h-20 w-full resize-y py-2.5" maxLength={RECEIPT_LIMIT}
              value={footerText} onChange={(event) => set('receiptText', event.target.value)} aria-label={t('Текст в чеке')} />
            <span className="text-right text-xs text-text-muted">{footerText.length}/{RECEIPT_LIMIT}</span>
          </label>

          {isOwner && <label className="grid gap-1.5 text-sm font-medium text-text-secondary">
            {t('Список печати счетов и чеков')}
            <select className="input w-full" value={form.receiptPrintRequestsOnly ? 'requests' : 'all'}
              aria-label={t('Список печати счетов и чеков')}
              onChange={(event) => set('receiptPrintRequestsOnly', event.target.value === 'requests')}>
              <option value="all">{t('Все доступные счета и чеки')}</option>
              <option value="requests">{t('Только по заявкам официантов')}</option>
            </select>
          </label>}
        </section>

      </fieldset>
      {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
      {editable && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <p className={dirty ? 'text-sm text-warning' : 'text-sm text-text-muted'}>
          {dirty ? t('Есть несохранённые изменения') : t('Все изменения сохранены')}
        </p>
        <button type="submit" className="btn-primary btn-md" disabled={!dirty || busy}>
          {update.isPending ? t('Сохраняем…') : t('Сохранить изменения')}
        </button>
      </div>}
    </form>
  );
}
