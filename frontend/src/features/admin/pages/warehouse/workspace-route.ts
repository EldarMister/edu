import { useLayoutEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

export interface EditorRoute {
  type: string;
  id?: string;
  action?: string;
  itemId?: string;
  warehouseId?: string;
}
const editorKeys = ['editor', 'id', 'action', 'itemId', 'editorWarehouse'];
const scrollPositions = new Map<string, number>();

export function useWorkspaceScroll() {
  const location = useLocation();
  const key = location.pathname + location.search;
  useLayoutEffect(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = scrollPositions.get(key) ?? 0;
  }, [key]);
}

export function useEditorRoute() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const type = params.get('editor');
  const editor: EditorRoute | null = type ? {
    type, id: params.get('id') || undefined, action: params.get('action') || undefined,
    itemId: params.get('itemId') || undefined, warehouseId: params.get('editorWarehouse') || undefined,
  } : null;

  function openEditor(next: EditorRoute, replace = false) {
    const url = new URLSearchParams(location.search);
    editorKeys.forEach((key) => url.delete(key));
    url.set('editor', next.type);
    if (next.id) url.set('id', next.id);
    if (next.action) url.set('action', next.action);
    if (next.itemId) url.set('itemId', next.itemId);
    if (next.warehouseId) url.set('editorWarehouse', next.warehouseId);
    const from = location.pathname + location.search;
    if (scrollPositions.size > 100) scrollPositions.clear();
    scrollPositions.set(from, document.querySelector('main')?.scrollTop ?? 0);
    navigate({ pathname: location.pathname, search: url.toString() }, {
      replace, state: replace ? location.state : { editorFrom: from },
    });
  }
  function closeEditor() {
    if (location.state?.editorFrom) { navigate(-1); return; }
    const url = new URLSearchParams(location.search);
    editorKeys.forEach((key) => url.delete(key));
    navigate({ pathname: location.pathname, search: url.toString() }, { replace: true });
  }
  return { editor, openEditor, closeEditor };
}

export function usePageFilter(name: string, defaultValue = ''): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  return [params.get(name) ?? defaultValue, (value) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === defaultValue) next.delete(name); else next.set(name, value);
      return next;
    }, { replace: true, state: location.state });
  }];
}

/** Change related conditions together so one router update cannot overwrite another. */
export function usePageFilters<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const values = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback])) as T;
  return [values, (patch) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) continue;
      if (value === defaults[key]) next.delete(key); else next.set(key, value);
    }
    return next;
  }, { replace: true, state: location.state })];
}
