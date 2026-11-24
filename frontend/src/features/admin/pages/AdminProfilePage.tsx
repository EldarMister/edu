import { useState } from 'react';
import { WorkShiftSettingsCard } from '@/features/settings/WorkShiftBanner';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { useLocale } from '@/store/locale';
import { IconGlobe, IconPrinter } from '../components/icons';

const languages = [
  { value: 'ru', label: 'Русский' },
  { value: 'ky', label: 'Кыргызча' },
] as const;

export function AdminProfilePage() {
  const user = useAuth((state) => state.user);
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <div className="max-w-4xl">
      <div className="workspace-stagger grid items-start gap-4 md:grid-cols-2">
        {user && <section className="card flex items-center gap-3 p-5 md:col-span-2">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">
            {Array.from(user.name.trim() || t('Профиль'))[0]?.toLocaleUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-text-primary">{user.name}</h2>
            <p className="mt-1 text-sm text-text-muted">{user.phone}</p>
          </div>
        </section>}
        <div className="space-y-4">
          <WorkShiftSettingsCard />
          {user?.role !== 'OWNER' && user?.permissions?.workShiftRequired === false && <section className="card space-y-2 p-5">
            <h3 className="text-[15px] font-semibold text-text-primary">{t('Смена')}</h3>
            <p className="text-sm text-text-muted">{t('Для вашей должности учёт смен отключён.')}</p>
          </section>}
          <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <IconGlobe className="h-4 w-4 text-text-muted" />
              {t('Язык системы')}
            </h3>
            <div role="group" aria-label={t('Язык системы')} className="flex rounded-lg border border-border p-0.5">
              {languages.map(({ value, label }) => <button key={value} type="button" aria-pressed={locale === value}
                onClick={() => setLocale(value)}
                className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-background aria-pressed:bg-primary/10 aria-pressed:text-primary">
                {t(label)}
              </button>)}
            </div>
          </section>
        </div>
        <PrinterSettings />
      </div>
    </div>
  );
}

function PrinterSettings() {
  const t = useT();
  const [printError, setPrintError] = useState(false);

  function testPrint() {
    setPrintError(false);
    const target = window.open('', '_blank', 'width=380,height=480');
    if (!target) {
      setPrintError(true);
      return;
    }
    target.document.title = t('Пробная печать');
    const sample = target.document.createElement('p');
    sample.style.cssText = 'width: 48mm; margin: 5mm auto; font: 14px sans-serif';
    sample.textContent = `EDU POS · ${t('Пробная печать')}`;
    target.document.body.append(sample);
    target.addEventListener('afterprint', () => target.close(), { once: true });
    target.focus();
    target.print();
  }

  return (
    <section className="card space-y-3 p-5" aria-labelledby="profile-printer-heading">
      <h3 id="profile-printer-heading" className="flex items-center gap-2 text-[15px] font-semibold text-text-primary">
        <IconPrinter className="h-5 w-5 text-text-secondary" />
        {t('Принтер чеков')}
      </h3>
      <p className="text-sm text-text-muted">{t('Выберите принтер в системном окне печати.')}</p>
      <button type="button" className="btn-secondary btn-md" onClick={testPrint}><IconPrinter />{t('Пробная печать')}</button>
      {printError && <p role="alert" className="text-sm text-danger">{t('Разрешите всплывающие окна и повторите печать.')}</p>}
    </section>
  );
}
