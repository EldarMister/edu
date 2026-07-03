import { AppState, Platform, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundService from 'react-native-background-actions';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { getSocket } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { kitchenVoice } from '@/services/kitchenVoice';
import { getKitchenVoiceSettings } from '@/services/kitchenVoiceSettings';
import { waiterVoice } from '@/services/waiterVoice';
import {
  stationVoice,
  waiterVoiceText,
  type StationVoicedOrder,
  type WaiterVoicedOrder,
} from '@/services/realtimeVoice';
import { scheduleRealtimeLocalNotification } from '@/services/push';
import { useAuth } from '@/store/auth';
import { beep } from '@/lib/sound';
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

const DEFAULT_CHANNEL: PttChannel = 'general';
const JOIN_INTERVAL_MS = 15_000;
const RECONNECT_INTERVAL_MS = 4_000;

let currentChannel: PttChannel = DEFAULT_CHANNEL;
let configuredAudio = false;
let subscribedToAudio = false;
let subscribedToRealtime = false;
let playing = false;
const audioQueue: PttAudioPayload[] = [];
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
  if (configuredAudio) return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
  configuredAudio = true;
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

function extensionForMime(mimeType: string) {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('mpeg')) return 'mp3';
  return 'm4a';
}

async function writeChunkToFile(payload: PttAudioPayload): Promise<string> {
  const ext = extensionForMime(payload.mimeType);
  const path = `${FileSystem.cacheDirectory}ptt-bg-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await FileSystem.writeAsStringAsync(path, payload.chunk, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

async function playFile(uri: string) {
  await configureBackgroundAudio().catch(() => undefined);
  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, volume: 1, progressUpdateIntervalMillis: 100 },
  );
  await new Promise<void>((resolve, reject) => {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) {
        if ('error' in status && status.error) reject(new Error(status.error));
        return;
      }
      if (status.didJustFinish) resolve();
    });
    sound.playAsync().catch(reject);
  }).finally(() => {
    sound.setOnPlaybackStatusUpdate(null);
    void sound.unloadAsync().catch(() => undefined);
  });
}

function pumpBackgroundAudio() {
  if (playing) return;
  const next = audioQueue.shift();
  if (!next) return;
  playing = true;
  void writeChunkToFile(next)
    .then(async (path) => {
      try {
        await playFile(path);
      } finally {
        await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      playing = false;
      pumpBackgroundAudio();
    });
}

function onBackgroundAudio(payload: PttAudioPayload) {
  if (Platform.OS !== 'android' || AppState.currentState === 'active') return;
  const userId = useAuth.getState().user?.id;
  if (payload.channel !== currentChannel || payload.senderId === userId) return;
  audioQueue.push(payload);
  pumpBackgroundAudio();
}

function shouldHandleBackgroundRealtime() {
  return Platform.OS === 'android' && AppState.currentState !== 'active';
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

function markVoiced(order: Pick<WaiterVoicedOrder, 'id' | 'status'>, text: string | null) {
  const voiceKey = `${order.status}:${text}`;
  if (!text || voicedOrders.get(order.id) === voiceKey) return false;
  voicedOrders.set(order.id, voiceKey);
  return true;
}

function onBackgroundNotification(payload: RealtimeNotification) {
  if (!shouldHandleBackgroundRealtime()) return;
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
  void beep('notify');
}

function onBackgroundKitchenNewOrder(order: StationVoicedOrder) {
  if (!shouldHandleBackgroundRealtime()) return;
  const station = currentStation();
  if (!station) return;
  const text = stationVoice(order, station);
  if (!text) return;
  const settings = getKitchenVoiceSettings();
  if (settings.notificationsEnabled) {
    void beep('newOrder');
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
  if (getKitchenVoiceSettings().notificationsEnabled) {
    void beep('notify');
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
  void scheduleRealtimeLocalNotification({
    title: 'Заказ официанта',
    body: notificationBody(order),
    data: { kind: 'waiter-order', orderId: order.id, status: order.status },
  });
  waiterVoice.enqueue(text);
}

function ensureBackgroundAudioSubscription() {
  if (subscribedToAudio) return;
  getSocket().on(PTT_EVENTS.AUDIO_STREAM, onBackgroundAudio);
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
  if (!subscribedToAudio) return;
  getSocket().off(PTT_EVENTS.AUDIO_STREAM, onBackgroundAudio);
  subscribedToAudio = false;
  audioQueue.length = 0;
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
  setPttBackgroundRuntimeActive(true);
  await configureBackgroundAudio().catch(() => undefined);
  ensureBackgroundAudioSubscription();
  ensureBackgroundRealtimeSubscription();
  let lastJoinAt = 0;

  try {
    while (BackgroundService.isRunning()) {
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
  currentChannel = channel;
  void AsyncStorage.setItem(PTT_CHANNEL_STORAGE_KEY, channel).catch(() => undefined);
  if (Platform.OS === 'android' && BackgroundService.isRunning()) {
    emitJoin(channel);
  }
}

export async function startPttBackgroundRuntime(channel: PttChannel) {
  currentChannel = channel;
  setPttBackgroundRuntimeActive(true);
  await configureBackgroundAudio().catch(() => undefined);
  ensureBackgroundAudioSubscription();
  ensureBackgroundRealtimeSubscription();

  if (Platform.OS !== 'android' || BackgroundService.isRunning()) return;

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
      foregroundServiceType: ['mediaPlayback', 'microphone'],
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
  setPttBackgroundRuntimeActive(false);
  removeBackgroundAudioSubscription();
  removeBackgroundRealtimeSubscription();
  if (Platform.OS === 'android' && BackgroundService.isRunning()) {
    await BackgroundService.stop();
  }
}
