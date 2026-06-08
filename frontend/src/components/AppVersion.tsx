import { useRef, useState } from 'react';
import { APP_VERSION_LABEL } from '@/lib/version';

/**
 * Принудительное обновление до последней версии: сносим service worker и кэши
 * (иначе PWA может держать старую сборку) и перезагружаем страницу начисто.
 */
async function forceUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    // Перезагрузка с обходом кэша.
    const url = new URL(window.location.href);
    url.searchParams.set('v', Date.now().toString());
    window.location.replace(url.toString());
  }
}

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
      void forceUpdate();
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
