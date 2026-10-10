import { AppState, Platform, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundService from 'react-native-background-actions';
import { getSocket } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { kitchenVoice } from '@/services/kitchenVoice';
import { getKitchenVoiceSettings } from '@/services/kitchenVoiceSettings';
import { waiterVoice } from '@/services/waiterVoice';
import {
  stationVoice,
  waiterVoiceKey,
  waiterVoiceText,
  type StationVoicedOrder,
  type WaiterVoicedOrder,
} from '@/services/realtimeVoice';
import { scheduleRealtimeLocalNotification, isRemotePushRegistered } from '@/services/push';
import { useAuth } from '@/store/auth';
import { configureAudioPlayback } from '@/lib/sound';
import { displayOrderNumber } from '@/utils/format';
import type { PrepStation } from '@/types';
import {
  PTT_CHANNELS,
  PTT_CHANNEL_STORAGE_KEY,
  PTT_EVENTS,
  type PttAudioPayload,
  type PttChannel,
} from './types';
import { setPttBackgroundRuntimeActive } from './backgroundFlag';
import { PttPlaybackQueue } from './audioPlayback';

const DEFAULT_CHANNEL: PttChannel = 'general';
const JOIN_INTERVAL_MS = 15_000;
const RECONNECT_INTERVAL_MS = 4_000;

let currentChannel: PttChannel = DEFAULT_CHANNEL;
let subscribedToAudio = false;
let subscribedToRealtime = false;
const playback = new PttPlaybackQueue();
let runtimeEpoch = 0;
const voicedOrders = new Map<string, string>();

type RealtimeNotification = {
  message: string;
  type?: string;
  orderId?: string;
  orderNumber?: string;
  at?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPttChannel(value: unknown): value is PttChannel {
  return PTT_CHANNELS.some((item) => item.key === value);
}

async function configureBackgroundAudio() {
  await configureAudioPlayback();
}

async function readStoredChannel(): Promise<PttChannel> {
  const stored = await AsyncStorage.getItem(PTT_CHANNEL_STORAGE_KEY).catch(() => null);
  return isPttChannel(stored) ? stored : currentChannel;
}

function emitJoin(channel: PttChannel) {
  const sock = getSocket();
  if (!sock.connected) sock.connect();
  sock.emit(PTT_EVENTS.JOIN, { channel });
}

function onBackgroundAudio(payload: PttAudioPayload) {
  if (Platform.OS !== 'android' || AppState.currentState === 'active') return;
  const userId = useAuth.getState().user?.id;
  if (!userId || !useAuth.getState().accessToken) return;
  if (payload.channel !== currentChannel || payload.senderId === userId) return;
  playback.enqueue(payload);
}

function shouldHandleBackgroundRealtime() {
  return Platform.OS === 'android' && AppState.currentState !== 'active' && !!useAuth.getState().accessToken;
}

function currentStation(): PrepStation | null {
  const role = useAuth.getState().user?.role;
  if (role === 'KITCHEN') return 'kitchen';
  if (role === 'BAR') return 'bar';
  return null;
}

function notificationBody(order: Pick<StationVoicedOrder, 'orderNumber' | 'table'>) {
  const orderNumber = displayOrderNumber(order.orderNumber);
  const table = order.table?.number ? ` · Стол ${order.table.number}` : '';
  return `Заказ ${orderNumber}${table}`;
}

function markVoiced(order: WaiterVoicedOrder, text: string | null) {
  const voiceKey = waiterVoiceKey(order, text);
  if (!text || !voiceKey || voicedOrders.get(order.id) === voiceKey) return false;
  voicedOrders.set(order.id, voiceKey);
  return true;
}

function onBackgroundNotification(payload: RealtimeNotification) {
  if (!shouldHandleBackgroundRealtime()) return;
  if (isRemotePushRegistered()) return;
  const orderNumber = payload.orderNumber ? displayOrderNumber(payload.orderNumber) : undefined;
  const body =
    payload.orderNumber && orderNumber
      ? payload.message.replace(payload.orderNumber, orderNumber)
      : payload.message;
  void scheduleRealtimeLocalNotification({
    title: 'EDU POS',
    body,
    data: { kind: 'realtime', orderId: payload.orderId, type: payload.type },
  });
}

function onBackgroundKitchenNewOrder(order: StationVoicedOrder) {
  if (!shouldHandleBackgroundRealtime()) return;
  const station = currentStation();
  if (!station) return;
  const text = stationVoice(order, station);
  if (!text) return;
  const settings = getKitchenVoiceSettings();
  if (settings.notificationsEnabled && !isRemotePushRegistered()) {
    Vibration.vibrate(400);
    void scheduleRealtimeLocalNotification({
      title: 'Новый заказ',
      body: notificationBody(order),
      data: { kind: 'kitchen-new-order', orderId: order.id },
    });
  }
  kitchenVoice.enqueue(text);
}

function onBackgroundKitchenStatusChanged(order: StationVoicedOrder) {
  if (!shouldHandleBackgroundRealtime()) return;
  const station = currentStation();
  if (!station) return;
  const text = stationVoice(order, station);
  if (!text) return;
  if (getKitchenVoiceSettings().notificationsEnabled && !isRemotePushRegistered()) {
    void scheduleRealtimeLocalNotification({
      title: 'Обновление заказа',
      body: notificationBody(order),
      data: { kind: 'kitchen-order-updated', orderId: order.id },
    });
  }
  kitchenVoice.enqueue(text);
}

function onBackgroundWaiterOrderChanged(order: WaiterVoicedOrder) {
  if (!shouldHandleBackgroundRealtime()) return;
  const user = useAuth.getState().user;
  if (user?.role !== 'WAITER' || !order.waiter?.id || order.waiter.id !== user.id) return;
  const text = waiterVoiceText(order);
  if (!markVoiced(order, text)) return;
  if (!isRemotePushRegistered()) void scheduleRealtimeLocalNotification({
    title: 'Заказ официанта',
    body: notificationBody(order),
    data: { kind: 'waiter-order', orderId: order.id, status: order.status },
  });
  waiterVoice.enqueue(text);
}

function ensureBackgroundAudioSubscription() {
  if (subscribedToAudio) return;
  getSocket().on(PTT_EVENTS.AUDIO_MESSAGE, onBackgroundAudio);
  subscribedToAudio = true;
}

function ensureBackgroundRealtimeSubscription() {
  if (subscribedToRealtime) return;
  const sock = getSocket();
  sock.on(SERVER_EVENTS.NOTIFICATION_NEW, onBackgroundNotification);
  sock.on(SERVER_EVENTS.KITCHEN_NEW_ORDER, onBackgroundKitchenNewOrder);
  sock.on(SERVER_EVENTS.ORDER_STATUS_CHANGED, onBackgroundKitchenStatusChanged);
  sock.on(SERVER_EVENTS.ORDER_STATUS_CHANGED, onBackgroundWaiterOrderChanged);
  sock.on(SERVER_EVENTS.WAITER_ORDER_READY, onBackgroundWaiterOrderChanged);
  sock.on(SERVER_EVENTS.WAITER_ORDER_REJECTED, onBackgroundWaiterOrderChanged);
  subscribedToRealtime = true;
}

function removeBackgroundAudioSubscription() {
  if (subscribedToAudio) {
    getSocket().off(PTT_EVENTS.AUDIO_MESSAGE, onBackgroundAudio);
    subscribedToAudio = false;
  }
  playback.clear();
}

function removeBackgroundRealtimeSubscription() {
  if (!subscribedToRealtime) return;
  const sock = getSocket();
  sock.off(SERVER_EVENTS.NOTIFICATION_NEW, onBackgroundNotification);
  sock.off(SERVER_EVENTS.KITCHEN_NEW_ORDER, onBackgroundKitchenNewOrder);
  sock.off(SERVER_EVENTS.ORDER_STATUS_CHANGED, onBackgroundKitchenStatusChanged);
  sock.off(SERVER_EVENTS.ORDER_STATUS_CHANGED, onBackgroundWaiterOrderChanged);
  sock.off(SERVER_EVENTS.WAITER_ORDER_READY, onBackgroundWaiterOrderChanged);
  sock.off(SERVER_EVENTS.WAITER_ORDER_REJECTED, onBackgroundWaiterOrderChanged);
  subscribedToRealtime = false;
}

async function pttBackgroundTask() {
  const epoch = runtimeEpoch;
  const userId = useAuth.getState().user?.id;
  await configureBackgroundAudio().catch(() => undefined);
  if (epoch !== runtimeEpoch || !userId || useAuth.getState().user?.id !== userId || !useAuth.getState().accessToken) return;
  setPttBackgroundRuntimeActive(true);
  ensureBackgroundAudioSubscription();
  ensureBackgroundRealtimeSubscription();
  let lastJoinAt = 0;

  try {
    while (BackgroundService.isRunning() && useAuth.getState().accessToken) {
      currentChannel = await readStoredChannel();
      const sock = getSocket();
      if (!sock.connected) sock.connect();

      const now = Date.now();
      if (now - lastJoinAt >= JOIN_INTERVAL_MS) {
        emitJoin(currentChannel);
        lastJoinAt = now;
      }

      await sleep(RECONNECT_INTERVAL_MS);
    }
  } finally {
    setPttBackgroundRuntimeActive(false);
    removeBackgroundAudioSubscription();
    removeBackgroundRealtimeSubscription();
  }
}

export function updatePttBackgroundChannel(channel: PttChannel) {
  if (channel !== currentChannel) playback.clear();
  currentChannel = channel;
  void AsyncStorage.setItem(PTT_CHANNEL_STORAGE_KEY, channel).catch(() => undefined);
  if (Platform.OS === 'android' && BackgroundService.isRunning()) {
    emitJoin(channel);
  }
}

export async function startPttBackgroundRuntime(channel: PttChannel) {
  currentChannel = channel;
  if (Platform.OS !== 'android') return;
  const userId = useAuth.getState().user?.id;
  const epoch = runtimeEpoch;
  if (AppState.currentState !== 'active' || !userId || !useAuth.getState().accessToken) return;
  await configureBackgroundAudio().catch(() => undefined);
  // Logout or a new receiver lifetime can complete while native audio initializes.
  if (epoch !== runtimeEpoch || useAuth.getState().user?.id !== userId || !useAuth.getState().accessToken || AppState.currentState !== 'active') return;
  setPttBackgroundRuntimeActive(true);
  ensureBackgroundAudioSubscription();
  ensureBackgroundRealtimeSubscription();

  if (BackgroundService.isRunning()) return;

  try {
    await BackgroundService.start(pttBackgroundTask, {
      taskName: 'EDU POS Рация',
      taskTitle: 'EDU POS Рация активна',
      taskDesc: 'Фоновое прослушивание канала рации',
      taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
      },
      color: '#005BFF',
      linkingURI: 'edupos://ptt',
      // Только mediaPlayback: фоновая служба лишь ВОСПРОИЗВОДИТ входящий звук.
      // Тип microphone на Android 14 требует уже выданного RECORD_AUDIO в момент
      // старта службы (сразу после логина его ещё нет) и роняет приложение.
      foregroundServiceType: ['mediaPlayback'],
      parameters: {},
    });
  } catch (error) {
    setPttBackgroundRuntimeActive(false);
    removeBackgroundAudioSubscription();
    removeBackgroundRealtimeSubscription();
    throw error;
  }
}

export async function stopPttBackgroundRuntime() {
  runtimeEpoch += 1;
  voicedOrders.clear();
  setPttBackgroundRuntimeActive(false);
  removeBackgroundAudioSubscription();
  removeBackgroundRealtimeSubscription();
  if (Platform.OS === 'android' && BackgroundService.isRunning()) {
    await BackgroundService.stop();
  }
}
