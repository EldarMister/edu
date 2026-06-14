import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

export type PushStatus =
  | 'unsupported'
  | 'unavailable'
  | 'default'
  | 'denied'
  | 'checking'
  | 'subscribed'
  | 'error';

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function getServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

function sameKey(subscription: PushSubscription, publicKey: string) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const want = urlBase64ToUint8Array(publicKey);
  const have = new Uint8Array(current);
  if (have.length !== want.length) return false;
  return have.every((b, i) => b === want[i]);
}

async function subscribeBrowser(publicKey: string) {
  const registration = await getServiceWorkerRegistration();
  // Дожидаемся активации SW — без этого pushManager.subscribe иногда падает.
  await navigator.serviceWorker.ready;

  let existing = await registration.pushManager.getSubscription();
  // Если на устройстве осталась подписка со старым VAPID-ключом — пересоздаём,
  // иначе push либо не доходит, либо subscribe бросает InvalidStateError.
  if (existing && !sameKey(existing, publicKey)) {
    await existing.unsubscribe();
    existing = null;
  }

  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON();
  await api.post('/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
  });
}

async function syncSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  await api.post('/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
  });
}

function initialStatus(supported: boolean): PushStatus {
  if (!supported) return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'checking';
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

export function usePushNotifications(enabled: boolean) {
  const supported = useMemo(
    () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    [],
  );
  const [status, setStatus] = useState<PushStatus>(() => initialStatus(supported));

  const enable = useCallback(async () => {
    if (!enabled || !supported) {
      setStatus('unsupported');
      return;
    }

    try {
      const { data } = await api.get<{ enabled: boolean; publicKey: string | null }>('/push/public-key');
      if (!data.enabled || !data.publicKey) {
        setStatus('unavailable');
        return;
      }

      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;

      if (permission === 'denied') {
        setStatus('denied');
        return;
      }
      if (permission !== 'granted') {
        setStatus('default');
        return;
      }

      await subscribeBrowser(data.publicKey);
      setStatus('subscribed');
    } catch (err) {
      // Реальную причину (нет HTTPS, SW не зарегистрировался, неверный VAPID-ключ
      // и т.п.) глушить нельзя — без неё «не работает» невозможно диагностировать.
      console.error('[push] не удалось включить уведомления:', err);
      setStatus('error');
    }
  }, [enabled, supported]);

  useEffect(() => {
    if (!enabled || !supported) return;

    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    if (Notification.permission !== 'granted') {
      setStatus('default');
      return;
    }

    let cancelled = false;
    setStatus('checking');

    void (async () => {
      try {
        const { data } = await api.get<{ enabled: boolean; publicKey: string | null }>('/push/public-key');
        if (!data.enabled || !data.publicKey) {
          if (!cancelled) setStatus('unavailable');
          return;
        }

        const registration = await getServiceWorkerRegistration();
        await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();

        if (existing && sameKey(existing, data.publicKey)) {
          if (!cancelled) setStatus('subscribed');
          void syncSubscription(existing).catch((err) => {
            console.error('[push] не удалось синхронизировать подписку:', err);
          });
          return;
        }

        if (!cancelled) await enable();
      } catch (err) {
        console.error('[push] не удалось проверить подписку:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enable, enabled, supported]);

  return { status, enable };
}

export function useWaiterPushNotifications(enabled: boolean) {
  return usePushNotifications(enabled);
}
