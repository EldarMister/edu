import { useEffect, useState } from 'react';

const STORAGE_KEY = 'intro:lastShownAt';
/**
 * Как часто показывать видео-заставку: при заходе, но не чаще одного раза за
 * этот интервал. «Почаще, но не надоедая». Значение синхронно с мобильным
 * клиентом (см. mobile useIntroSplash.INTRO_MIN_INTERVAL_MS).
 */
const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 часа

/**
 * Полноэкранная видео-заставка PWA. Автоплей приглушённый (иначе браузер
 * блокирует автозапуск) — звук на вебе необязателен. Без кнопки пропуска:
 * играет до конца, затем исчезает. Показ троттлится через localStorage.
 */
export function IntroSplash() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const last = raw ? Number(raw) : 0;
      const due = !last || Number.isNaN(last) || Date.now() - last >= MIN_INTERVAL_MS;
      if (due) setShow(true);
    } catch {
      /* localStorage недоступен — просто не показываем заставку */
    }
  }, []);

  if (!show) return null;

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-primary">
      <video
        src="/intro.mp4"
        className="h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        onEnded={finish}
        onError={finish}
      />
    </div>
  );
}
