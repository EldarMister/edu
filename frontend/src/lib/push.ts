import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type PushStatus = 'unsupported' | 'unavailable' | 'default' | 'denied' | 'subscribed' | 'error';

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

async function subscribeBrowser(publicKey: string) {
  const registration = await getServiceWorkerRegistration();
  const existing = await registration.pushManager.getSubscription();
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

export function useWaiterPushNotifications(enabled: boolean) {
  const supported = useMemo(
    () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    [],
  );
  const [status, setStatus] = useState<PushStatus>(supported ? 'default' : 'unsupported');

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
    } catch {
      setStatus('error');
    }
  }, [enabled, supported]);

  useEffect(() => {
    if (!enabled || !supported || Notification.permission !== 'granted') return;
    void enable();
  }, [enable, enabled, supported]);

  return { status, enable };
}
