import { useRef, useState } from 'react';
import { refreshAppToLatestVersion } from '@/lib/app-update';
import { APP_VERSION_LABEL } from '@/lib/version';

const TAPS_TO_UPDATE = 3;
const TAP_WINDOW_MS = 1500;

/** Версия сборки — мелким серым текстом. Тройной тап = принудительное обновление. */
export function AppVersion({ className = '' }: { className?: string }) {
  const taps = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updating, setUpdating] = useState(false);

  function onTap() {
    if (updating) return;
    taps.current += 1;
    if (timer.current) clearTimeout(timer.current);

    if (taps.current >= TAPS_TO_UPDATE) {
      taps.current = 0;
      setUpdating(true);
      void refreshAppToLatestVersion();
      return;
    }
    timer.current = setTimeout(() => {
      taps.current = 0;
    }, TAP_WINDOW_MS);
  }

  return (
    <button
      type="button"
      onClick={onTap}
      title={`${APP_VERSION_LABEL} — тройное нажатие обновит до последней версии`}
      className={`mx-auto block select-none text-center text-xs text-text-light ${className}`}
    >
      {updating ? 'Обновление…' : APP_VERSION_LABEL}
    </button>
  );
}
