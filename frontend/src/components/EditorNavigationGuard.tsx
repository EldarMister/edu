import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBeforeUnload, useBlocker, type Blocker, type BlockerFunction } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { Modal } from './Modal';

type SaveEditor = () => Promise<boolean>;
const editors = new Set<{ dirty: boolean; save?: SaveEditor }>();
const dirtyEditors = () => [...editors].filter((editor) => editor.dirty);
const hasChanges = () => dirtyEditors().length > 0;

/** Register a form independently of where its header/footer are rendered. */
export function useEditorDirty(dirty: boolean, save?: SaveEditor) {
  const entry = useRef<{ dirty: boolean; saved: boolean; save?: SaveEditor }>({ dirty: false, saved: false });
  useLayoutEffect(() => {
    const current = entry.current;
    editors.add(current);
    return () => { editors.delete(current); };
  }, []);
  useLayoutEffect(() => {
    if (!dirty) entry.current.saved = false;
    entry.current.dirty = dirty && !entry.current.saved;
    entry.current.save = save;
  });
  const markSaved = useCallback(() => { entry.current.saved = true; entry.current.dirty = false; }, []);
  return { markSaved };
}

function editorKey(location: { pathname: string; search: string }) {
  const params = new URLSearchParams(location.search);
  return [location.pathname, ...['section', 'view', 'editor', 'id', 'action'].map((key) => params.get(key))].join('|');
}

export function EditorNavigationGuard() {
  const blocker = useBlocker(useCallback<BlockerFunction>(({ currentLocation, nextLocation }) =>
    hasChanges() && nextLocation.pathname !== '/login' && editorKey(currentLocation) !== editorKey(nextLocation), []));
  useBeforeUnload(useCallback((event) => {
    if (hasChanges()) { event.preventDefault(); event.returnValue = ''; }
  }, []));
  return blocker.state === 'blocked' ? createPortal(<UnsavedChangesDialog blocker={blocker} />, document.body) : null;
}

function UnsavedChangesDialog({ blocker }: { blocker: Extract<Blocker, { state: 'blocked' }> }) {
  const t = useT();
  const [canSave] = useState(() => {
    const pending = dirtyEditors();
    return pending.length > 0 && pending.every((editor) => editor.save !== undefined);
  });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  async function saveAndLeave() {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      for (const editor of dirtyEditors()) {
        if (editor.dirty && (!editor.save || !await editor.save())) {
          setSaveFailed(true);
          return;
        }
      }
      blocker.proceed();
    } finally {
      setSaving(false);
    }
  }

  function stay() {
    if (!saving) blocker.reset();
  }

  return <Modal open manageFocus title={t('Есть несохранённые изменения')} onClose={stay} footer={
    <div className={canSave ? 'space-y-2' : ''}>
      {canSave && <button type="button" disabled={saving} className="btn-primary btn-lg w-full"
        onClick={() => void saveAndLeave()}>
        {saving ? t('Сохраняем…') : t('Сохранить и выйти')}
      </button>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" data-dialog-initial-focus disabled={saving} className="btn-secondary btn-lg h-auto min-h-12 px-2 py-2" onClick={stay}>
          {t('Продолжить редактирование')}
        </button>
        <button type="button" disabled={saving} className="btn-danger btn-lg h-auto min-h-12 px-2 py-2" onClick={() => blocker.proceed()}>
          {t('Выйти без сохранения')}
        </button>
      </div>
    </div>
  }>
    <p className="text-sm text-text-secondary">{canSave ? t('Сохранить изменения перед переходом на другую страницу?')
        : 'Изменения в документе ещё не сохранены. Остаться на странице и закончить работу?'}</p>
    {saveFailed && <p role="alert" className="mt-2 text-sm text-danger">{t('Не удалось сохранить изменения. Проверьте поля и повторите попытку.')}</p>}
  </Modal>;
}
