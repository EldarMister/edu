import { useState } from 'react';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { WorkspacePending } from '../admin/components/WorkspacePending';
import { useAdminSettings, useTestFiscalConnection, useUpdateSettings } from './api';

type Mode = '' | 'mock';

export function FiscalSettingsPage() {
  const t = useT();
  const { canEditSection, isOwner } = usePermissions();
  const editable = canEditSection('settings');
  const settings = useAdminSettings();
  const update = useUpdateSettings();
  const test = useTestFiscalConnection();
  const push = useNotifications((state) => state.push);
  const [draft, setDraft] = useState<Mode>();
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);
  const saved = settings.data?.fiscalProvider ?? '';
  const mode = draft ?? saved;
  const dirty = draft !== undefined && (draft !== saved || update.isPending);
  const { markSaved } = useEditorDirty(editable && dirty, save);

  if (settings.isPending) return <WorkspacePending />;
  if (settings.error) return <p role="alert" className="text-sm text-danger">{apiError(settings.error)}</p>;

  async function save() {
    if (!editable || !dirty || draft === undefined || update.isPending || test.isPending) return false;
    setError('');
    try {
      await update.mutateAsync({ fiscalProvider: draft });
      markSaved();
      setDraft(undefined);
      push({ message: t('Настройки сохранены'), type: 'success', at: new Date().toISOString() });
      return true;
    } catch (failure) {
      setError(apiError(failure));
      return false;
    }
  }

  async function runTest() {
    setError('');
    setTested(false);
    try {
      const result = await test.mutateAsync();
      if (result.ok) setTested(true);
      else setError(t('Проверка эмуляции не прошла'));
    } catch (failure) {
      setError(apiError(failure));
    }
  }

  return (
    <div className="workspace-stagger max-w-3xl space-y-4">
      <section className="card space-y-3 p-5">
        <label className="grid gap-1.5 text-sm text-text-secondary">
          {t('Режим ККМ')}
          <select className="input max-w-sm" aria-label={t('Режим ККМ')} value={mode}
            disabled={!editable || update.isPending || test.isPending}
            onChange={(event) => {
              setDraft(event.target.value === 'mock' ? 'mock' : '');
              setError('');
              setTested(false);
            }}>
            <option value="">{t('Выключена')}</option>
            <option value="mock">{t('Эмуляция')}</option>
            {saved === 'ekassa' && <option value="ekassa" disabled>eKassa · {t('Ожидает подключения')}</option>}
            {saved === 'yakassa' && <option value="yakassa" disabled>YaKassa · {t('Ожидает подключения')}</option>}
          </select>
        </label>
        {mode === 'mock' && <p className="text-sm text-text-muted">{t('Эмуляция формирует тестовый чек для проверки печати.')}</p>}
        {editable && <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary btn-md" disabled={!dirty || update.isPending} onClick={() => void save()}>
            {t('Сохранить изменения')}
          </button>
          {isOwner && saved === 'mock' && !dirty && <button type="button" className="btn-secondary btn-md"
            disabled={test.isPending} onClick={() => void runTest()}>
            {test.isPending ? t('Проверка…') : t('Проверить эмуляцию')}
          </button>}
          {tested && <span role="status" className="text-sm text-success">{t('Эмуляция работает')}</span>}
        </div>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </section>

      <section className="card space-y-3 p-5 text-sm">
        <h2 className="font-semibold text-text-primary">{t('Подключение кассы')}</h2>
        <p className="text-text-secondary">
          {t('Для смарт-карты NewCas использует FiscalCore на кассовом компьютере. Для подключения к EDU POS нужны модель считывателя и версия фискального сервиса.')}
        </p>
        <a className="inline-block text-primary hover:underline" href="https://support.goodoo.kg/knowledgebase.php?article=8" target="_blank" rel="noreferrer">
          NewCas · {t('Установка FiscalCore для Windows')}
        </a>
        <div className="border-t border-border pt-3">
          <p className="text-text-secondary">{t('Для подключения eKassa или YaKassa нужны спецификация API и тестовый доступ к кассе.')}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <a className="text-primary hover:underline" href="https://ekassa.kg/api/" target="_blank" rel="noreferrer">eKassa API</a>
            <a className="text-primary hover:underline" href="https://yakassa.kg/blog/integracziya-onlajn-kassy-s-vashej-sistemoj-uchyota-kak-eto-rabotaeta/" target="_blank" rel="noreferrer">YaKassa API</a>
          </div>
        </div>
      </section>
    </div>
  );
}
