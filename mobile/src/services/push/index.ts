import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from '@/lib/api';

// Показывать уведомления, когда приложение открыто (баннер + звук).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

/**
 * Запрашивает разрешение, получает Expo push token и регистрирует устройство на backend.
 * Native push нужен, когда приложение свёрнуто/закрыто (ТЗ §12).
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return; // на эмуляторе push-токен недоступен

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'EDU POS',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'notify.mp3',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#005BFF',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync('default', {
      name: 'EDU POS',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'notify.mp3',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#005BFF',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

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
