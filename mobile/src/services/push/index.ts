import { Platform } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from '@/lib/api';

export const ORDER_NOTIFICATION_CHANNEL_ID = 'orders_v3';
const NOTIFICATION_SOUND = 'notify.mp3';
export type PushStatus =
  | 'unsupported'
  | 'unavailable'
  | 'default'
  | 'denied'
  | 'checking'
  | 'subscribed'
  | 'error';

// Показывать уведомления, когда приложение открыто (баннер + звук).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

async function ensureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ORDER_NOTIFICATION_CHANNEL_ID, {
    name: 'EDU POS',
    importance: Notifications.AndroidImportance.HIGH,
    sound: NOTIFICATION_SOUND,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#005BFF',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync('default_v3', {
    name: 'EDU POS',
    importance: Notifications.AndroidImportance.HIGH,
    sound: NOTIFICATION_SOUND,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#005BFF',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function playNotificationSoundTest(): Promise<boolean> {
  await ensureAndroidNotificationChannels();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return false;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'EDU POS',
        body: 'Проверка звука уведомления',
        sound: NOTIFICATION_SOUND,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        vibrate: [0, 250, 250, 250],
        data: { kind: 'sound-test' },
      },
      trigger: Platform.OS === 'android' ? { channelId: ORDER_NOTIFICATION_CHANNEL_ID } : null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Запрашивает разрешение, получает Expo push token и регистрирует устройство на backend.
 * Native push нужен, когда приложение свёрнуто/закрыто (ТЗ §12).
 */
export async function registerForPushNotifications(): Promise<void> {
  await ensureAndroidNotificationChannels();
  if (!Device.isDevice) return; // на эмуляторе push-токен недоступен

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    registeredToken = token;
    await api.post('/push/devices', {
      pushToken: token,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version,
    });
  } catch {
    // Без projectId (вне EAS) токен получить нельзя — тихо пропускаем в dev.
  }
}

/** Отключает текущее устройство (при logout). */
export async function unregisterPushDevice(): Promise<void> {
  if (!registeredToken) return;
  try {
    await api.delete('/push/devices', { data: { pushToken: registeredToken } });
  } catch {
    // игнорируем — устройство всё равно почистится по DeviceNotRegistered
  }
  registeredToken = null;
}

async function currentPushStatus(): Promise<PushStatus> {
  await ensureAndroidNotificationChannels();
  if (!Device.isDevice) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'denied') return 'denied';
  if (status !== 'granted') return 'default';
  return registeredToken ? 'subscribed' : 'checking';
}

export function usePushNotifications(enabled: boolean) {
  const [status, setStatus] = useState<PushStatus>('checking');

  const enable = useCallback(async () => {
    if (!enabled) {
      setStatus('unsupported');
      return;
    }
    setStatus('checking');
    try {
      await registerForPushNotifications();
      const next = await currentPushStatus();
      setStatus(next === 'checking' ? 'error' : next);
    } catch {
      setStatus('error');
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await currentPushStatus();
        if (cancelled) return;
        if (next === 'checking') {
          await enable();
          return;
        }
        setStatus(next);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enable, enabled]);

  return { status, enable };
}

export function useWaiterPushNotifications(enabled: boolean) {
  return usePushNotifications(enabled);
}
