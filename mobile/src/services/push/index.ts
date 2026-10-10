import { AppState, Platform } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { API_BASE } from '@/config/env';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { queryClient } from '@/lib/queryClient';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/utils/format';
import { PushRegistrationManager, type PushRegistrationState, type PushStatus } from './registration';
import { notificationData, notificationDeduper, notificationTarget, type NotificationTarget } from './events';

export type { PushStatus, NotificationTarget };
export { notificationDeduper };
export const ORDER_NOTIFICATION_CHANNEL_ID = 'orders_v3';
const NOTIFICATION_SOUND = 'notify.mp3';
const STORAGE_KEY = 'edu-pos-push-registration-v2';
const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
let channelsReady: Promise<void> | null = null;

export function ensureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelsReady ??= (async () => {
    for (const [id, name, sound] of [
      [ORDER_NOTIFICATION_CHANNEL_ID, 'Заказы', NOTIFICATION_SOUND],
      ['kitchen_v3', 'Кухня и бар', 'new_order.mp3'],
      ['payments_v3', 'Оплата и печать', 'payment_sound.mp3'],
      ['default_v3', 'EDU POS', NOTIFICATION_SOUND],
    ]) {
      await Notifications.setNotificationChannelAsync(id, {
        name, importance: Notifications.AndroidImportance.HIGH, sound,
        vibrationPattern: [0, 250, 250, 250], lightColor: '#005BFF',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
  })().catch((error) => { channelsReady = null; throw error; });
  return channelsReady;
}

function session() {
  const auth = useAuth.getState();
  return auth.user && auth.accessToken ? { userId: auth.user.id, accessToken: auth.accessToken } : null;
}

async function acquireExpoToken() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Notifications.getExpoPushTokenAsync({ projectId }).then((response) => response.data),
      new Promise<string>((_, reject) => { timeout = setTimeout(() => reject(new Error('Push token request timed out')), 15_000); }),
    ]);
  } finally { clearTimeout(timeout); }
}

const registration = new PushRegistrationManager({
  session,
  available: () => {
    // Android emulators with Google Play services support FCM token registration.
    if (Platform.OS === 'web' || (Platform.OS !== 'android' && !Device.isDevice)) return 'unsupported';
    if (!projectId || Constants.appOwnership === 'expo') return 'unavailable';
    return 'supported';
  },
  permission: async (prompt) => {
    await ensureAndroidNotificationChannels();
    let permission = await Notifications.getPermissionsAsync();
    if (prompt && permission.status !== 'granted' && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    const granted = permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    return granted ? 'granted' : permission.status === 'denied' ? 'denied' : 'default';
  },
  token: acquireExpoToken,
  load: async () => {
    const saved = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!saved) return null;
    try {
      const data = JSON.parse(saved) as PushRegistrationState;
      const validBinding = (binding: NonNullable<PushRegistrationState['binding']>) =>
        !!binding && typeof binding.userId === 'string' && typeof binding.accessToken === 'string' && typeof binding.pushToken === 'string';
      if (typeof data.deviceId === 'string' && Array.isArray(data.pending) &&
        (data.binding === null || validBinding(data.binding)) && data.pending.every(validBinding)) return data;
    } catch { /* A malformed legacy record must not permanently block registration. */ }
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    return null;
  },
  save: (state) => SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(state)),
  deviceId: () => `expo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
  register: async (binding, deviceId) => {
    await axios.post(`${API_BASE}/push/devices`, {
      pushToken: binding.pushToken, deviceId, provider: 'EXPO', platform: Platform.OS,
      appVersion: Constants.expoConfig?.version,
    }, { headers: { Authorization: `Bearer ${binding.accessToken}` }, timeout: 15_000 });
  },
  unregister: async (binding) => {
    await axios.delete(`${API_BASE}/push/devices`, {
      data: { pushToken: binding.pushToken }, headers: { Authorization: `Bearer ${binding.accessToken}` }, timeout: 15_000,
    });
  },
});

export function isRemotePushRegistered() { return registration.hasRegisteredBinding; }

function belongsToCurrentUser(data: Record<string, unknown>) {
  const userId = useAuth.getState().user?.id;
  return !!userId && (typeof data.recipientUserId !== 'string' || data.recipientUserId === userId);
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const { content } = notification.request;
    const data = notificationData(content);
    if (data.kind === 'sound-test') return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false };
    const accepted = belongsToCurrentUser(data) && notificationDeduper.claim(data, content.body ?? '');
    if (accepted && AppState.currentState === 'active') {
      const number = typeof data.orderNumber === 'string' ? displayOrderNumber(data.orderNumber) : undefined;
      const body = content.body ?? content.title ?? 'Новое уведомление';
      useNotifications.getState().push({
        message: typeof data.orderNumber === 'string' && number ? body.replace(data.orderNumber, number) : body,
        type: data.type === 'success' || data.type === 'error' ? data.type : 'info',
        orderId: typeof data.orderId === 'string' ? data.orderId : undefined, orderNumber: number,
        at: typeof data.at === 'string' ? data.at : new Date().toISOString(),
      });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['kitchen'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      void beep(data.channel === 'kitchen' ? 'newOrder' : 'notify');
    }
    // In the foreground one toast/sound is shared with realtime. With JS suspended
    // or terminated, the OS presents the server's remote notification itself.
    return { shouldShowAlert: accepted && AppState.currentState !== 'active', shouldPlaySound: accepted && AppState.currentState !== 'active', shouldSetBadge: false };
  },
});

export async function scheduleRealtimeLocalNotification({ title, body, data = {} }: {
  title: string; body: string; data?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await ensureAndroidNotificationChannels();
    if (!(await Notifications.getPermissionsAsync()).granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: NOTIFICATION_SOUND, priority: Notifications.AndroidNotificationPriority.HIGH,
        vibrate: [0, 250, 250, 250], data: { ...data, recipientUserId: useAuth.getState().user?.id } },
      trigger: Platform.OS === 'android' ? { channelId: ORDER_NOTIFICATION_CHANNEL_ID } : null,
    });
    return true;
  } catch { return false; }
}

export async function playNotificationSoundTest(): Promise<boolean> {
  try {
    await ensureAndroidNotificationChannels();
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return false;
    return scheduleRealtimeLocalNotification({ title: 'EDU POS', body: 'Проверка звука уведомления', data: { kind: 'sound-test' } });
  } catch { return false; }
}

export async function registerForPushNotifications(): Promise<PushStatus> { return registration.reconcile(true); }
export async function unregisterPushDevice(): Promise<void> { await registration.unregister(); }

/** Mount once at the root, including login, so failed logout cleanup retries. */
export function usePushNotificationLifecycle() {
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const sync = (prompt = false) => {
      clearTimeout(retry);
      void registration.reconcile(prompt).then((status) => {
        if (disposed) return;
        if ((status === 'error' || registration.hasPendingRevocations) && AppState.currentState === 'active') {
          retry = setTimeout(() => sync(), Math.min(60_000, 2_000 * 2 ** Math.min(attempts++, 5)));
        } else { attempts = 0; }
      });
    };
    sync(!!session());
    const authSub = useAuth.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) {
        notificationDeduper.clear();
        if (previous.user && previous.accessToken) {
          void registration.unregister({ userId: previous.user.id, accessToken: previous.accessToken });
        }
        sync(!!next.user);
      } else if (next.accessToken !== previous.accessToken) { sync(); }
    });
    const tokenSub = Notifications.addPushTokenListener(() => sync());
    const stateSub = AppState.addEventListener('change', (state) => { if (state === 'active') sync(); });
    const droppedSub = Notifications.addNotificationsDroppedListener(() => { void queryClient.invalidateQueries(); });
    return () => { disposed = true; clearTimeout(retry); authSub(); tokenSub.remove(); stateSub.remove(); droppedSub.remove(); };
  }, []);
}

export function usePushNotifications(enabled: boolean) {
  const [status, setStatus] = useState<PushStatus>(enabled ? registration.status : 'unsupported');
  useEffect(() => {
    if (!enabled) { setStatus('unsupported'); return; }
    const unsubscribe = registration.subscribe(setStatus);
    void registration.reconcile(false);
    return unsubscribe;
  }, [enabled]);
  const enable = useCallback(async () => { if (enabled) await registration.reconcile(true); }, [enabled]);
  return { status, enable };
}

export const useWaiterPushNotifications = usePushNotifications;

/** Keep a cold-start tap pending until auth hydration and the navigator are ready. */
export function useNotificationNavigation({ ready, userId, role, onNavigate }: {
  ready: boolean; userId?: string; role?: string; onNavigate: (target: NotificationTarget) => void;
}) {
  const [pending, setPending] = useState<Notifications.NotificationResponse | null>(null);
  const handled = useRef<string | null>(null);
  const callback = useRef(onNavigate);
  callback.current = onNavigate;
  useEffect(() => {
    let active = true;
    const listener = Notifications.addNotificationResponseReceivedListener(setPending);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (active && response) setPending((current) => current ?? response);
    }).catch(() => undefined);
    return () => { active = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (!pending || !ready || !userId || !role) return;
    const key = `${pending.notification.request.identifier}:${pending.actionIdentifier}`;
    if (handled.current === key) return;
    handled.current = key;
    if (pending.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      const target = notificationTarget(notificationData(pending.notification.request.content), userId, role);
      if (target) callback.current(target);
    }
    setPending(null);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [pending, ready, userId, role]);
}
