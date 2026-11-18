import { useCallback, useLayoutEffect, useRef } from 'react';
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router-dom';
import { Modal } from './Modal';

const editors = new Set<{ dirty: boolean }>();
const hasChanges = () => [...editors].some((editor) => editor.dirty);

/** Register a form independently of where its header/footer are rendered. */
export function useEditorDirty(dirty: boolean) {
  const entry = useRef({ dirty: false, saved: false });
  useLayoutEffect(() => {
    const current = entry.current;
    editors.add(current);
    return () => { editors.delete(current); };
  }, []);
  useLayoutEffect(() => {
    if (!dirty) entry.current.saved = false;
    entry.current.dirty = dirty && !entry.current.saved;
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
  if (blocker.state !== 'blocked') return null;
  return <Modal open title="Есть несохранённые изменения" onClose={() => blocker.reset()} footer={
    <div className="grid grid-cols-2 gap-2">
      <button type="button" autoFocus className="btn-secondary btn-lg h-auto min-h-12 rounded px-2 py-2" onClick={() => blocker.reset()}>Продолжить редактирование</button>
      <button type="button" className="btn-danger btn-lg h-auto min-h-12 rounded px-2 py-2 font-semibold" onClick={() => blocker.proceed()}>Выйти без сохранения</button>
    </div>
  }><p className="text-sm text-text-secondary">Изменения в документе ещё не сохранены. Остаться на странице и закончить работу?</p></Modal>;
}
