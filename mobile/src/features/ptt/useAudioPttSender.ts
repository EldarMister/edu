import React from 'react';
import { AppState } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { configureAudioRecording } from '@/lib/sound';
import { getSocket } from '@/services/socket';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload } from './types';
import { playPttCue } from './sounds';

const MIME_TYPE = 'audio/mp4';

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

type Ack = { ok: boolean; reason?: string };

function socketAck(event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    getSocket().timeout(5000).emit(event, payload, (error: Error | null, ack: Ack | undefined) =>
      resolve(error ? { ok: false, reason: 'timeout' } : ack ?? { ok: false }));
  });
}

export function useAudioPttSender(channel: PttChannel, enabled: boolean) {
  const [talking, setTalking] = React.useState(false);
  const [deniedReason, setDeniedReason] = React.useState<string | null>(null);
  const activeRef = React.useRef(false);
  const holdRef = React.useRef(false);
  const startingRef = React.useRef(false);
  const finishingRef = React.useRef(false);
  const channelHeldRef = React.useRef(false);
  const cueRef = React.useRef<AbortController | null>(null);
  const recordingRef = React.useRef<Audio.Recording | null>(null);

  const releaseChannel = React.useCallback(() => {
    getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
    if (channelHeldRef.current) {
      channelHeldRef.current = false;
      void playPttCue('end');
    }
  }, [channel]);

  // Telegram-модель: единая непрерывная запись. На отпускании кнопки
  // останавливаем запись, читаем итоговый .m4a целиком в base64, отправляем
  // одним эвентом ptt_audio_message и только затем освобождаем канал.
  const finishRecording = React.useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      releaseChannel();
      return;
    }
    let uri: string | null = null;
    try {
      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
      if (uri) {
        const chunk = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (chunk) {
          getSocket().emit(PTT_EVENTS.AUDIO_MESSAGE, { channel, mimeType: MIME_TYPE, chunk });
        }
      }
    } catch {
      // Слишком короткая запись может кинуть E_AUDIO_NODATA — просто отбрасываем.
    } finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      await configureAudioRecording(false).catch(() => undefined);
      releaseChannel();
    }
  }, [channel, releaseChannel]);

  const stop = React.useCallback(() => {
    holdRef.current = false;
    cueRef.current?.abort();
    if (!activeRef.current) return;
    activeRef.current = false;
    setTalking(false);
    if (finishingRef.current) return;
    finishingRef.current = true;
    void finishRecording().finally(() => {
      finishingRef.current = false;
    });
  }, [finishRecording]);

  const start = React.useCallback(async () => {
    if (!enabled || activeRef.current || startingRef.current || finishingRef.current) return false;
    startingRef.current = true;
    holdRef.current = true;
    setDeniedReason(null);
    const cue = new AbortController();
    cueRef.current = cue;
    const startCue = playPttCue('start', cue.signal);
    let prepared: Audio.Recording | null = null;
    try {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      setDeniedReason('Разрешите доступ к микрофону');
      return false;
    }
    if (!holdRef.current) return false;

    const ack = await socketAck(PTT_EVENTS.START_TALK, { channel });
    if (!ack.ok) {
      releaseChannel();
      setDeniedReason(ack.reason === 'busy' ? 'Канал занят' : 'Не удалось начать разговор');
      return false;
    }
    channelHeldRef.current = true;
    await startCue;

    if (!holdRef.current) {
      releaseChannel();
      return false;
    }

    try {
      await configureAudioRecording(true);
    } catch {
      setDeniedReason('Не удалось включить микрофон');
      releaseChannel();
      await configureAudioRecording(false).catch(() => undefined);
      return false;
    }
    if (!holdRef.current) {
      releaseChannel();
      await configureAudioRecording(false).catch(() => undefined);
      return false;
    }

    try {
      const recording = new Audio.Recording();
      prepared = recording;
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();
      recordingRef.current = recording;
      prepared = null;
    } catch {
      recordingRef.current = null;
      setDeniedReason('Не удалось включить микрофон');
      await prepared?.stopAndUnloadAsync().catch(() => undefined);
      prepared = null;
      releaseChannel();
      await configureAudioRecording(false).catch(() => undefined);
      return false;
    }

    // Запись уже пишется в recordingRef — только теперь помечаем сессию активной,
    // чтобы stop() во время подготовки не оставил осиротевший рекордер.
    activeRef.current = true;
    setTalking(true);
    if (!holdRef.current) stop();
    return true;
    } catch {
      setDeniedReason('Не удалось начать разговор');
      releaseChannel();
      await configureAudioRecording(false).catch(() => undefined);
      return false;
    } finally {
      cue.abort();
      if (cueRef.current === cue) cueRef.current = null;
      startingRef.current = false;
      if (!activeRef.current) holdRef.current = false;
    }
  }, [channel, enabled, stop, releaseChannel]);

  React.useEffect(() => {
    const sock = getSocket();
    const onDenied = (payload: PttDeniedPayload) => {
      if (payload.channel && payload.channel !== channel) return;
      // Сервер шлёт talk_denied и на неудачный ptt_join (например, гонка с
      // аутентификацией сокета) — это не про текущую попытку говорить.
      if (!holdRef.current && !activeRef.current) return;
      setDeniedReason(payload.reason === 'busy' ? 'Канал занят' : 'Разговор недоступен');
      stop();
    };
    sock.on(PTT_EVENTS.TALK_DENIED, onDenied);
    return () => {
      sock.off(PTT_EVENTS.TALK_DENIED, onDenied);
    };
  }, [channel, stop]);

  React.useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  React.useEffect(() => () => stop(), [stop]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') stop();
    });
    return () => subscription.remove();
  }, [stop]);

  return { talking, deniedReason, start, stop };
}
