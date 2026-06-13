import { useEffect, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { Toggle } from '@/components/Toggle';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { useLocale, type Locale } from '@/store/locale';
import {
  IconGlobe,
  IconQr,
  IconCash,
  IconCard,
  IconPrinter,
} from '../admin/components/icons';
import { useAdminSettings, useUpdateSettings } from './api';
import { QrPaymentCard } from './QrPaymentCard';

interface Form {
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  receiptText: string;
  serviceChargeAmount: string;
  language: Locale;
  payQr: boolean;
  payCash: boolean;
  payCard: boolean;
}

const RECEIPT_LIMIT = 120;

export function SettingsPage() {
  const { data, isLoading } = useAdminSettings();
  const update = useUpdateSettings();
  const push = useNotifications((s) => s.push);
  const setLocale = useLocale((s) => s.setLocale);
  const t = useT();

  const [form, setForm] = useState<Form | null>(null);
  const saveTimer = useRef<number | null>(null);
  const hydrateRef = useRef(true);

  useEffect(() => {
    if (data) {
      setForm({
        cafeName: data.cafeName,
        address: data.address,
        phone: data.phone,
        phone2: data.phone2,
        receiptText: data.receiptText,
        serviceChargeAmount: String(data.serviceChargeAmount ?? 0),
        language: data.language,
        payQr: data.payQr,
        payCash: data.payCash,
        payCard: data.payCard,
      });
    }
  }, [data?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !form || !data) {
    return (
      <div className="flex justify-center py-16 text-primary">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  const persist = async (next: Form) => {
    if (!next.payQr && !next.payCash && !next.payCard) {
      return;
    }
    try {
      await update.mutateAsync({
        ...form,
        serviceChargeAmount: Math.max(0, Number(form.serviceChargeAmount) || 0),
      });
      setLocale(next.language);
    } catch (err) {
      const msg = apiError(err);
      push({ message: msg, type: 'error', at: new Date().toISOString() });
    }
  };

  const schedulePersist = (next: Form) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void persist(next);
    }, 700);
  };

  const set = <K extends keyof Form>(k: K, v: Form[K], mode: 'debounce' | 'instant' = 'debounce') => {
    let nextForm: Form | null = null;
    let blockedNoMethod = false;
    setForm((f) => {
      if (!f) return f;
      nextForm = { ...f, [k]: v };
      if (!nextForm.payQr && !nextForm.payCash && !nextForm.payCard) {
        nextForm = f;
        blockedNoMethod = true;
        return f;
      }
      return nextForm;
    });
    if (blockedNoMethod) {
      return;
    }
    if (!nextForm || nextForm[k] !== v) return;
    if (nextForm && !hydrateRef.current) {
      if (mode === 'instant') {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        void persist(nextForm);
      } else {
        schedulePersist(nextForm);
      }
    }
  };

  const selectLanguage = (language: Locale) => {
    set('language', language, 'instant');
    setLocale(language);
  };

  const noMethod = !form.payQr && !form.payCash && !form.payCard;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Левая большая карточка — информация о кафе */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="mb-4 text-[17px] font-semibold text-text-primary">{t('Информация о кафе')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Название кафе')} className="sm:col-span-2">
              <input
                className="input"
                value={form.cafeName}
                onChange={(e) => set('cafeName', e.target.value)}
                placeholder="EDU CAFE"
              />
            </Field>
            <Field label={t('Адрес')} className="sm:col-span-2">
              <input
                className="input"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="г. Бишкек, ул. Киевская 120"
              />
            </Field>
            <Field label={t('Номер телефона')}>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+996 500 123 456"
              />
            </Field>
            <Field label={t('Доп. номер')}>
              <input
                className="input"
                value={form.phone2}
                onChange={(e) => set('phone2', e.target.value)}
                placeholder="+996 700 123 456"
              />
            </Field>
            <Field label={t('Текст в чеке')} className="sm:col-span-2">
              <textarea
                className="input h-24 resize-none py-2.5"
                maxLength={RECEIPT_LIMIT}
                value={form.receiptText}
                onChange={(e) => set('receiptText', e.target.value)}
                placeholder="Спасибо за покупку!"
              />
              <p className="mt-1 text-right text-xs text-text-muted">
                {form.receiptText.length}/{RECEIPT_LIMIT}
              </p>
            </Field>
            {/* Статус принтера */}
            <div className="pt-2">
              <div className="mb-3 flex items-center gap-2">
                <IconPrinter className="h-5 w-5 text-text-secondary" />
                <h3 className="text-[15px] font-semibold text-text-primary">{t('Статус принтера')}</h3>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    data.printerConnected ? 'bg-success/10 text-success' : 'bg-slate-100 text-text-muted'
                  }`}
                >
                  <IconPrinter className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p
                    className={`text-[15px] font-medium ${
                      data.printerConnected ? 'text-success' : 'text-text-muted'
                    }`}
                  >
                    {data.printerConnected ? t('Подключен') : t('Не подключен')}
                  </p>
                  <p className="text-xs text-text-muted">
                    {data.printerConnected
                      ? t('Принтер чеков подключен и готов к печати')
                      : t('Принтер чеков не подключен')}
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Правая колонка */}
        <div className="space-y-4">
          {/* Язык системы */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <IconGlobe className="h-5 w-5 text-text-secondary" />
              <h3 className="text-[15px] font-semibold text-text-primary">{t('Язык системы')}</h3>
            </div>
            <div className="flex rounded-xl bg-background p-1">
              {(
                [
                  { value: 'ru', label: 'Русский' },
                  { value: 'ky', label: 'Кыргызча' },
                ] as { value: Locale; label: string }[]
              ).map((l) => (
                <button
                  key={l.value}
                  onClick={() => selectLanguage(l.value)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                    form.language === l.value
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {t(l.label)}
                </button>
              ))}
            </div>
          </div>

          {/* Способы оплаты */}
          <div className="card p-5">
            <h3 className="mb-3 text-[15px] font-semibold text-text-primary">{t('Способы оплаты')}</h3>
            <div className="space-y-1">
              <PayRow
                icon={<IconQr className="h-5 w-5" />}
                tone="primary"
                title={t('QR-код')}
                desc={t('Оплата через QR-код')}
                checked={form.payQr}
                onChange={(v) => set('payQr', v)}
              />
              <PayRow
                icon={<IconCash className="h-5 w-5" />}
                tone="success"
                title={t('Наличные')}
                desc={t('Оплата наличными средствами')}
                checked={form.payCash}
                onChange={(v) => set('payCash', v)}
              />
              <PayRow
                icon={<IconCard className="h-5 w-5" />}
                tone="warning"
                title={t('Карта')}
                desc={t('Оплата банковской картой')}
                checked={form.payCard}
                onChange={(v) => set('payCard', v)}
              />
            </div>
            <p className={`mt-3 text-xs ${noMethod ? 'text-danger' : 'text-text-muted'}`}>
              {noMethod
                ? t('Должен быть включён хотя бы один способ оплаты')
                : t('Отключённые способы оплаты будут недоступны на экране оплаты')}
            </p>
            {form.payQr && !data.qrImageUrl && (
              <p className="mt-2 text-xs text-warning">
                {t('QR-оплата включена, но QR-код не загружен — официанты не смогут принять оплату по QR.')}
              </p>
            )}
          </div>

          {/* QR-оплата */}
          <QrPaymentCard qrImageUrl={data.qrImageUrl} />

          {/* Статус принтера */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <IconPrinter className="h-5 w-5 text-text-secondary" />
              <h3 className="text-[15px] font-semibold text-text-primary">{t('Статус принтера')}</h3>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  data.printerConnected ? 'bg-success/10 text-success' : 'bg-slate-100 text-text-muted'
                }`}
              >
                <IconPrinter className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p
                  className={`text-[15px] font-medium ${
                    data.printerConnected ? 'text-success' : 'text-text-muted'
                  }`}
                >
                  {data.printerConnected ? t('Подключен') : t('Не подключен')}
                </p>
                <p className="text-xs text-text-muted">
                  {data.printerConnected
                    ? t('Принтер чеков подключен и готов к печати')
                    : t('Принтер чеков не подключен')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function PayRow({
  icon,
  tone,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  tone: 'primary' | 'success' | 'warning';
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const tones: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
  };
  return (
    <div className="flex items-center gap-3 rounded-xl px-1 py-2.5">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-muted">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
