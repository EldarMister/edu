import { AppState, Platform } from 'react-native';

const PRINT_LAUNCH_TIMEOUT_MS = 15_000;
const cancelled = () => new Error('Печать отменена');

/** Android SDK 52 resolves printAsync when PrintManager opens its activity.
 *  Wait for that activity to close before showing anything in MainActivity. */
export async function waitForNativePrintReturn(printAsync: () => Promise<void>, signal?: AbortSignal) {
  if (signal?.aborted) throw cancelled();
  if (Platform.OS !== 'android') {
    await printAsync();
    return;
  }

  let leftApp = false;
  let returned = false;
  let finished = false;
  let launchTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReturn!: () => void;
  let rejectReturn!: (error: Error) => void;
  const returnToApp = new Promise<void>((resolve, reject) => {
    resolveReturn = resolve;
    rejectReturn = reject;
  });
  const clearLaunchTimer = () => {
    if (launchTimer !== undefined) clearTimeout(launchTimer);
    launchTimer = undefined;
  };
  // Subscribe before invoking printAsync: both lifecycle events can arrive
  // before its promise settles, or only after it has already resolved.
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      leftApp = true;
      clearLaunchTimer();
    } else if (state === 'active' && leftApp) {
      returned = true;
      resolveReturn();
    }
  });
  const onAbort = () => rejectReturn(cancelled());
  signal?.addEventListener('abort', onAbort);

  try {
    const launched = Promise.resolve().then(() => {
      if (signal?.aborted) throw cancelled();
      return printAsync();
    }).then(() => {
      if (!finished && !leftApp && !returned) {
        // A missing print activity must release the caller instead of leaving
        // every receipt action disabled. Time spent in the print UI is unlimited.
        launchTimer = setTimeout(() => rejectReturn(new Error('Не удалось открыть системное окно печати. Повторите печать.')), PRINT_LAUNCH_TIMEOUT_MS);
      }
    });
    await Promise.all([launched, returnToApp]);
  } finally {
    finished = true;
    clearLaunchTimer();
    subscription.remove();
    signal?.removeEventListener('abort', onAbort);
  }
}
