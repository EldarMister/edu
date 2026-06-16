import { useEffect, useRef, useState } from 'react';
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
import { useAdminSettings, useUpdateSettings, useTestFiscalConnection, type SettingsInput } from './api';
import { QrPaymentCard } from './QrPaymentCard';

type FiscalProvider = '' | 'ekassa' | 'yakassa' | 'mock';

interface Form {
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string;
  website: string;
  receiptText: string;
  serviceChargeAmount: string;
  language: Locale;
  payQr: boolean;
  payCash: boolean;
  payCard: boolean;
  fiscalProvider: FiscalProvider;
  fiscalEkassaApiKey: string;
  fiscalEkassaUrl: string;
  fiscalEkassaInn: string;
  fiscalYakassaApiKey: string;
  fiscalYakassaUrl: string;
}

const RECEIPT_LIMIT = 120;

export function SettingsPage() {
  const { data, isLoading, isError, error } = useAdminSettings();
  const update = useUpdateSettings();
  const testFiscal = useTestFiscalConnection();
  const push = useNotifications((s) => s.push);
  const setLocale = useLocale((s) => s.setLocale);
  const t = useT();
  const [fiscalCheck, setFiscalCheck] = useState<'ok' | 'fail' | null>(null);

  const [form, setForm] = useState<Form | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const hydrateRef = useRef(true);

  useEffect(() => {
    if (data) {
      setForm({
        cafeName: data.cafeName,
        address: data.address,
        phone: data.phone,
        phone2: data.phone2,
        instagram: data.instagram ?? '',
        website: data.website ?? '',
        receiptText: data.receiptText,
        serviceChargeAmount: '0',
        language: data.language,
        payQr: data.payQr,
        payCash: data.payCash,
        payCard: data.payCard,
        fiscalProvider: (data.fiscalProvider ?? '') as FiscalProvider,
        fiscalEkassaApiKey: data.fiscalEkassaApiKey ?? '',
        fiscalEkassaUrl: data.fiscalEkassaUrl ?? '',
        fiscalEkassaInn: data.fiscalEkassaInn ?? '',
        fiscalYakassaApiKey: data.fiscalYakassaApiKey ?? '',
        fiscalYakassaUrl: data.fiscalYakassaUrl ?? '',
      });
      hydrateRef.current = false;
    }
  }, [data?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-primary">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (isError || !form || !data) {
    return (
      <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
        {apiError(error)}
      </div>
    );
  }

  const enqueuePersist = (patch: SettingsInput) => {
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await update.mutateAsync(patch);
          if (patch.language) setLocale(patch.language as Locale);
        } catch (err) {
          const msg = apiError(err);
          push({ message: msg, type: 'error', at: new Date().toISOString() });
        }
      });
    return saveQueue.current;
  };

  const schedulePersist = (patch: SettingsInput) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void enqueuePersist(patch);
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
    const patch = { [k]: v } as SettingsInput;
    if (nextForm && !hydrateRef.current) {
      if (mode === 'instant') {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        void enqueuePersist(patch);
      } else {
        schedulePersist(patch);
      }
    }
  };

  const selectLanguage = (language: Locale) => {
    set('language', language, 'instant');
    setLocale(language);
  };

  const noMethod = !form.payQr && !form.payCash && !form.payCard;

  const runFiscalCheck = async () => {
    setFiscalCheck(null);
    try {
      const res = await testFiscal.mutateAsync();
      setFiscalCheck(res.ok ? 'ok' : 'fail');
      if (!res.ok) {
        push({
          message: t('ККМ не ответила. Проверьте провайдера, URL и ключ.'),
          type: 'error',
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setFiscalCheck('fail');
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

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
            <Field label="Instagram">
              <input
                className="input"
                value={form.instagram}
                onChange={(e) => set('instagram', e.target.value)}
                placeholder="@edu_cafe"
              />
            </Field>
            <Field label={t('Сайт')}>
              <input
                className="input"
                value={form.website}
                onChange={(e) => set('website', e.target.value)}
                placeholder="edu-cafe.kg"
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
            <div className="sm:col-span-2 rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-text-secondary">
              <p>EDU POS печатает предчек / внутренний товарный чек.</p>
              <p>Фискальный чек формируется только через подключенную ККМ или онлайн-кассу.</p>
            </div>
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
                onChange={(v) => set('payQr', v, 'instant')}
              />
              <PayRow
                icon={<IconCash className="h-5 w-5" />}
                tone="success"
                title={t('Наличные')}
                desc={t('Оплата наличными средствами')}
                checked={form.payCash}
                onChange={(v) => set('payCash', v, 'instant')}
              />
              <PayRow
                icon={<IconCard className="h-5 w-5" />}
                tone="warning"
                title={t('Карта')}
                desc={t('Оплата банковской картой')}
                checked={form.payCard}
                onChange={(v) => set('payCard', v, 'instant')}
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

          {/* ККМ / Фискализация */}
          <div className="card p-5">
            <h3 className="mb-1 text-[15px] font-semibold text-text-primary">{t('ККМ / Фискализация')}</h3>
            <p className="mb-3 text-xs text-text-muted">
              {t('Без подключённой ККМ печатается товарный чек. С ККМ — фискальный чек с QR ГНС.')}
            </p>

            <p className="mb-1.5 text-sm font-medium text-text-secondary">{t('Провайдер')}</p>
            <div className="space-y-1.5">
              {(
                [
                  { value: '' as FiscalProvider, label: t('Выключено') },
                  { value: 'ekassa' as FiscalProvider, label: 'eKassa (Telemedia Group)' },
                  { value: 'yakassa' as FiscalProvider, label: 'YaKassa' },
                  { value: 'mock' as FiscalProvider, label: t('Тест (эмуляция)') },
                ]
              ).map((p) => (
                <label
                  key={p.value || 'off'}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="fiscalProvider"
                    checked={form.fiscalProvider === p.value}
                    onChange={() => {
                      setFiscalCheck(null);
                      set('fiscalProvider', p.value, 'instant');
                    }}
                    className="accent-primary"
                  />
                  <span className="text-text-primary">{p.label}</span>
                </label>
              ))}
            </div>

            {form.fiscalProvider === 'ekassa' && (
              <div className="mt-3 grid gap-3">
                <Field label={t('URL API eKassa')}>
                  <input
                    className="input"
                    value={form.fiscalEkassaUrl}
                    onChange={(e) => set('fiscalEkassaUrl', e.target.value)}
                    placeholder="https://api.ekassa.kg"
                  />
                </Field>
                <Field label={t('API-ключ')}>
                  <input
                    className="input"
                    value={form.fiscalEkassaApiKey}
                    onChange={(e) => set('fiscalEkassaApiKey', e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <Field label={t('ИНН заведения')}>
                  <input
                    className="input"
                    value={form.fiscalEkassaInn}
                    onChange={(e) => set('fiscalEkassaInn', e.target.value)}
                    placeholder="0000000000000"
                  />
                </Field>
              </div>
            )}

            {form.fiscalProvider === 'yakassa' && (
              <div className="mt-3 grid gap-3">
                <Field label={t('URL API YaKassa')}>
                  <input
                    className="input"
                    value={form.fiscalYakassaUrl}
                    onChange={(e) => set('fiscalYakassaUrl', e.target.value)}
                    placeholder="https://api.yakassa.kg"
                  />
                </Field>
                <Field label={t('API-ключ')}>
                  <input
                    className="input"
                    value={form.fiscalYakassaApiKey}
                    onChange={(e) => set('fiscalYakassaApiKey', e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
              </div>
            )}

            {form.fiscalProvider === 'mock' && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                {t('Режим эмуляции: чек не уходит в ГНС, генерируется тестовый номер и QR. Для проверки сценария без реального ключа.')}
              </p>
            )}

            {form.fiscalProvider && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={runFiscalCheck}
                  disabled={testFiscal.isPending}
                  className="rounded-lg border border-primary/40 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  {testFiscal.isPending ? t('Проверка…') : t('Проверить соединение')}
                </button>
                {fiscalCheck === 'ok' && (
                  <span className="text-sm font-medium text-success">{t('✅ Соединение установлено')}</span>
                )}
                {fiscalCheck === 'fail' && (
                  <span className="text-sm font-medium text-danger">{t('❌ Нет соединения')}</span>
                )}
              </div>
            )}
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
