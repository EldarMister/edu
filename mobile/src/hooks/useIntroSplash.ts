import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'intro:lastShownAt';
/**
 * Как часто показывать видео-заставку: при холодном старте, но не чаще одного
 * раза за этот интервал. «Почаще, но не надоедая» — несколько раз в день максимум,
 * без повтора при частых перезапусках. Значение легко поменять.
 */
export const INTRO_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 часа

type IntroStatus = 'checking' | 'show' | 'done';

/**
 * Решает, показывать ли заставку на этом запуске. Проверка идёт один раз при
 * монтировании App (то есть при холодном старте, не при возврате из фона).
 */
export function useIntroSplash() {
  const [status, setStatus] = useState<IntroStatus>('checking');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive) return;
        const last = raw ? Number(raw) : 0;
        const due = !last || Number.isNaN(last) || Date.now() - last >= INTRO_MIN_INTERVAL_MS;
        setStatus(due ? 'show' : 'done');
      })
      .catch(() => {
        if (alive) setStatus('done');
      });
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(() => {
    void AsyncStorage.setItem(STORAGE_KEY, String(Date.now())).catch(() => {});
    setStatus('done');
  }, []);

  return { status, finish };
}
