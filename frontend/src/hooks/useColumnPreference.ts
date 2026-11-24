import { useState } from 'react';
import { useAuth } from '@/store/auth';

function readPreference(key: string, fallback: string) {
  try { return window.localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

export function useColumnPreference(view: string, fallback = ''): [string, (value: string) => void] {
  const userId = useAuth((state) => state.user?.id);
  const key = `edu-pos-columns:${userId ?? 'guest'}:${view}`;
  const [saved, setSaved] = useState(() => ({ key, value: readPreference(key, fallback) }));

  return [saved.key === key ? saved.value : readPreference(key, fallback), (value) => {
    setSaved({ key, value });
    try {
      if (value !== fallback) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // The current view can still apply the selection without browser storage.
    }
  }];
}
