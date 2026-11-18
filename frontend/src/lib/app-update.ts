export const APP_RELOAD_PARAM = '__edu_reload';
const UPDATE_TIMEOUT_MS = 25_000;
let pendingUpdate: Promise<void> | undefined;

async function waitForAppWorker(deadline: number) {
  if (!('serviceWorker' in navigator)) return;
  const workers = navigator.serviceWorker;
  const previous = workers.controller;
  const registration = await workers.getRegistration();
  if (!registration) return;

  await registration.update();
  const incoming = registration.installing ?? registration.waiting ??
    (registration.active !== previous ? registration.active : null);
  if (!incoming) return;

  // update() may finish while Workbox is still precaching the new build.
  while (Date.now() < deadline) {
    const controller = workers.controller;
    if (controller && controller !== previous && controller.state === 'activated') return;
    if (incoming.state === 'redundant') throw new Error('Service worker installation failed');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Service worker activation timed out');
}

async function applyUpdate() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + UPDATE_TIMEOUT_MS;
  try {
    await Promise.race([
      waitForAppWorker(deadline),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('App update timed out')), UPDATE_TIMEOUT_MS);
      }),
    ]);
    const url = new URL(window.location.href);
    url.searchParams.set(APP_RELOAD_PARAM, Date.now().toString());
    window.location.replace(url.toString());
  } finally {
    clearTimeout(timer);
  }
}

export function refreshAppToLatestVersion() {
  return pendingUpdate ??= applyUpdate().finally(() => {
    pendingUpdate = undefined;
  });
}
