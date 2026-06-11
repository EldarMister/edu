import { useEffect, useState } from 'react';
import { APP_COMMIT } from '@/lib/version';

const STORAGE_KEY = 'update_snooze_until';
const SNOOZE_MS = 60 * 60 * 1000; // 1 час
const POLL_INTERVAL_MS = 5 * 60 * 1000; // проверяем каждые 5 минут

/**
 * Хук опрашивает /version.json (создаётся при сборке) и сравнивает
 * commit-хэш с текущим. Если отличается — возвращает updateAvailable=true.
 * Учитывает «Позже» — не показывает раньше конца snooze-периода.
 */
export function useUpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    // Проверяем не в снузе ли мы
    function isSnoozed() {
      const until = localStorage.getItem(STORAGE_KEY);
      return until ? Date.now() < Number(until) : false;
    }

    async function check() {
      if (isSnoozed()) return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.commit && data.commit !== APP_COMMIT) {
          setUpdateAvailable(true);
        }
      } catch {
        // нет сети — молча игнорируем
      }
    }

    void check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  function snooze() {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + SNOOZE_MS));
    setUpdateAvailable(false);
    // Через час перепроверим — snooze уже истечёт
    setTimeout(() => setUpdateAvailable(true), SNOOZE_MS);
  }

  return { updateAvailable, snooze };
}
