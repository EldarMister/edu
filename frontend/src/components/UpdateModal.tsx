import { useUpdateNotifier } from '@/hooks/useUpdateNotifier';

/**
 * Принудительное обновление: сносим service worker + кэши, перезагружаем.
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
    const url = new URL(window.location.href);
    url.searchParams.set('v', Date.now().toString());
    window.location.replace(url.toString());
  }
}

/**
 * Модальное уведомление об обновлении.
 * Появляется автоматически при выходе новой версии.
 * «Позже» — откладывает на 1 час.
 */
export function UpdateModal() {
  const { updateAvailable, snooze } = useUpdateNotifier();

  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center p-4 sm:items-center">
      {/* Полупрозрачный оверлей */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Карточка */}
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Цветная полоска сверху */}
        <div className="h-1 bg-gradient-to-r from-primary to-blue-400" />

        <div className="p-6">
          {/* Иконка */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </div>

          <h3 className="mb-1 text-center text-[17px] font-semibold text-text-primary">
            Доступно обновление
          </h3>
          <p className="mb-6 text-center text-sm text-text-muted">
            Вышла новая версия приложения. Обновите, чтобы получить исправления и улучшения.
          </p>

          <div className="flex flex-col gap-2.5">
            <button
              className="btn-primary btn-lg w-full font-semibold"
              onClick={() => void forceUpdate()}
            >
              Обновить сейчас
            </button>
            <button
              className="btn-secondary btn-lg w-full"
              onClick={snooze}
            >
              Позже (напомнить через 1 час)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
