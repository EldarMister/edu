import React from 'react';
import { AppState } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { getSocket } from '@/services/socket';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload } from './types';

const SEGMENT_MS = 300;
const PCM_INTERVAL_MS = 150;
const MIME_TYPE = 'audio/mp4';
const continuousCapture = requireOptionalNativeModule<{
  start(token: number): Promise<boolean>;
  take(token: number): string | null;
  finish(token: number): string[] | string | null;
  addListener?(event: 'onChunkReady' | 'onCaptureEnded', handler: (payload: { token: number }) => void): { remove(): void };
}>('EduRadioCapture');
let nextCaptureToken = Date.now();

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};

type Ack = { ok: boolean; reason?: string };
type Attempt = {
  connection?: string;
  requested: boolean;
  released: boolean;
  wake?: () => void;
  finishCapture?: () => void;
};

function configureAudio(recording: boolean) {
  return Audio.setAudioModeAsync({
    allowsRecordingIOS: recording,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: !recording,
    playThroughEarpieceAndroid: false,
  });
}

function waitForSegment(attempt: Attempt, interval = SEGMENT_MS) {
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); attempt.wake = undefined; resolve(); };
    const timer = setTimeout(done, interval);
    attempt.wake = done;
    if (attempt.released) done();
  });
}

export function useAudioPttSender(channel: PttChannel, enabled: boolean) {
  const [talking, setTalking] = React.useState(false);
  const [deniedReason, setDeniedReason] = React.useState<string | null>(null);
  const current = React.useRef<Attempt | null>(null);
  const stop = React.useCallback(() => {
    const attempt = current.current;
    if (!attempt) return;
    attempt.released = true;
    if (attempt.finishCapture) {
      attempt.finishCapture();
      if (current.current === attempt) current.current = null;
    }
    attempt.wake?.();
    setTalking(false);
  }, []);

  const start = React.useCallback(async () => {
    if (!enabled || current.current) return false;
    const socket = getSocket();
    if (!socket.connected) return false;
    const attempt: Attempt = { connection: socket.id, requested: false, released: false };
    current.current = attempt;
    setDeniedReason(null);
    let audioConfigured = false;
    let sendFiles = Promise.resolve();
    const connected = () => socket.connected && socket.id === attempt.connection;
    const releaseChannel = () => {
      if (attempt.requested && connected()) socket.emit(PTT_EVENTS.STOP_TALK, { channel });
      attempt.requested = false;
    };
    try {
      const existing = await Audio.getPermissionsAsync();
      // Opening Android's permission dialog interrupts the current press.
      const permission = existing.granted ? existing : await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setDeniedReason('Разрешите доступ к микрофону');
        return false;
      }
      if (attempt.released || !connected()) return false;
      attempt.requested = true;
      const ack: Ack = await socket.timeout(3500).emitWithAck(PTT_EVENTS.START_TALK, { channel });
      if (!ack.ok) {
        attempt.requested = false;
        setDeniedReason(ack.reason === 'busy' ? 'Канал занят' : 'Не удалось начать разговор');
        return false;
      }
      if (attempt.released || !connected()) return false;
      let sequence = 0;
      if (continuousCapture) {
        const token = ++nextCaptureToken;
        const send = (chunk: string | null) => {
          if (chunk && connected()) {
            socket.emit(PTT_EVENTS.CHUNK, { channel, seq: sequence++, mimeType: 'audio/wav', chunk });
          }
        };
        const subscriptions: { remove(): void }[] = [];
        const removeListeners = () => { subscriptions.splice(0).forEach(subscription => subscription.remove()); };
        const finish = () => {
          if (!attempt.finishCapture) return;
          attempt.finishCapture = undefined;
          try {
            removeListeners();
            const tail = continuousCapture.finish(token);
            if (Array.isArray(tail)) tail.forEach(send);
            else send(tail);
          }
          catch { setDeniedReason('Не удалось передать окончание фразы'); }
          finally { releaseChannel(); }
        };
        attempt.finishCapture = finish;
        if (continuousCapture.addListener) {
          subscriptions.push(continuousCapture.addListener('onChunkReady', (event) => {
            if (event.token === token && !attempt.released && connected()) send(continuousCapture.take(token));
          }));
          subscriptions.push(continuousCapture.addListener('onCaptureEnded', (event) => {
            if (event.token !== token || current.current !== attempt) return;
            setDeniedReason('Запись с микрофона прервалась');
            stop();
          }));
        }
        const opened = await continuousCapture.start(token).catch(() => false);
        if (opened) {
          try {
            if (!attempt.released) setTalking(true);
            while (!attempt.released && connected()) {
              await waitForSegment(attempt, subscriptions.length ? 1000 : PCM_INTERVAL_MS);
              if (!attempt.released && connected()) send(continuousCapture.take(token));
            }
          } finally {
            finish();
          }
          return true;
        }
        removeListeners();
        attempt.finishCapture = undefined;
      }
      // Older builds, Expo Go and devices without this input use the file recorder.
      if (attempt.released || !connected()) return false;
      await configureAudio(true);
      audioConfigured = true;
      while (!attempt.released && connected()) {
        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync(RECORDING_OPTIONS);
        try {
          if (attempt.released) break;
          await recording.startAsync();
          if (!attempt.released) setTalking(true);
          await waitForSegment(attempt);
        } finally {
          try { await recording.stopAndUnloadAsync(); }
          catch (error) { if (!attempt.released) throw error; }
          const uri = recording.getURI();
          if (uri) {
            const seq = sequence++;
            // Start the next recording while the completed segment is read and delivered.
            sendFiles = sendFiles.then(async () => {
              try {
                if (!connected()) return;
                const chunk = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
                if (chunk && connected()) socket.emit(PTT_EVENTS.CHUNK, { channel, mimeType: MIME_TYPE, seq, chunk });
              } finally { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined); }
            }).catch(() => setDeniedReason('Не удалось передать часть фразы'));
          }
        }
      }
      return true;
    } catch {
      if (!attempt.released) setDeniedReason('Не удалось начать или продолжить передачу');
      return false;
    } finally {
      if (current.current === attempt) setTalking(false);
      if (audioConfigured) await configureAudio(false).catch(() => undefined);
      await sendFiles;
      releaseChannel();
      if (current.current === attempt) current.current = null;
    }
  }, [channel, enabled, stop]);

  React.useEffect(() => {
    if (!enabled) stop();
    const socket = getSocket();
    const denied = (payload: PttDeniedPayload) => {
      if ((payload.channel && payload.channel !== channel) || !current.current) return;
      setDeniedReason(payload.reason === 'busy' ? 'Канал занят' : 'Разговор недоступен');
      stop();
    };
    const disconnect = () => {
      if (current.current) setDeniedReason('Связь прервалась. Повторите фразу после подключения');
      stop();
    };
    const appState = AppState.addEventListener('change', (state) => { if (state === 'background') stop(); });
    socket.on(PTT_EVENTS.TALK_DENIED, denied);
    socket.on('disconnect', disconnect);
    return () => {
      appState.remove();
      socket.off(PTT_EVENTS.TALK_DENIED, denied);
      socket.off('disconnect', disconnect);
      stop();
    };
  }, [channel, enabled, stop]);

  return { talking, deniedReason, start, stop };
}
