/**
 * Безопасное обновление приложения:
 * сначала просим браузер проверить новый service worker, затем перезагружаем
 * текущий URL с cache-busting параметром. Не удаляем кэши/регистрации заранее,
 * чтобы не оставлять PWA в полузагруженном состоянии на слабой сети.
 */
export async function refreshAppToLatestVersion() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.update().catch(() => undefined)));
    }
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.set('v', Date.now().toString());
    window.location.replace(url.toString());
  }
}
