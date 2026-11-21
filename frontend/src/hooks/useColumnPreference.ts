import { useState } from 'react';
import { useAuth } from '@/store/auth';

function readPreference(key: string) {
  try { return window.localStorage.getItem(key) ?? ''; }
  catch { return ''; }
}

export function useColumnPreference(view: string): [string, (value: string) => void] {
  const userId = useAuth((state) => state.user?.id);
  const key = `edu-pos-columns:${userId ?? 'guest'}:${view}`;
  const [saved, setSaved] = useState(() => ({ key, value: readPreference(key) }));

  return [saved.key === key ? saved.value : readPreference(key), (value) => {
    setSaved({ key, value });
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // The current view can still apply the selection without browser storage.
    }
  }];
}
