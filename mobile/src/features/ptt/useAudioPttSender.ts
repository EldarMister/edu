import React from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { configureAudioPlayback } from '@/lib/sound';
import { getSocket } from '@/services/socket';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload } from './types';

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
    getSocket().emit(event, payload, (ack: Ack | undefined) => resolve(ack ?? { ok: false }));
  });
}

async function configureRecordingAudio() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

export function useAudioPttSender(channel: PttChannel, enabled: boolean) {
  const [talking, setTalking] = React.useState(false);
  const [deniedReason, setDeniedReason] = React.useState<string | null>(null);
  const activeRef = React.useRef(false);
  const holdRef = React.useRef(false);
  const finishingRef = React.useRef(false);
  const recordingRef = React.useRef<Audio.Recording | null>(null);

  // Telegram-модель: единая непрерывная запись. На отпускании кнопки
  // останавливаем запись, читаем итоговый .m4a целиком в base64, отправляем
  // одним эвентом ptt_audio_message и только затем освобождаем канал.
  const finishRecording = React.useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
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
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      await configureAudioPlayback().catch(() => undefined);
    }
  }, [channel]);

  const stop = React.useCallback(() => {
    holdRef.current = false;
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
    if (!enabled || activeRef.current) return false;
    holdRef.current = true;
    setDeniedReason(null);
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      setDeniedReason('Разрешите доступ к микрофону');
      return false;
    }

    const ack = await socketAck(PTT_EVENTS.START_TALK, { channel });
    if (!ack.ok) {
      setDeniedReason(ack.reason === 'busy' ? 'Канал занят' : 'Не удалось начать разговор');
      return false;
    }

    if (!holdRef.current) {
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      return false;
    }

    try {
      await configureRecordingAudio();
    } catch {
      setDeniedReason('Не удалось включить микрофон');
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      await configureAudioPlayback().catch(() => undefined);
      return false;
    }
    if (!holdRef.current) {
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      await configureAudioPlayback().catch(() => undefined);
      return false;
    }

    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();
      recordingRef.current = recording;
    } catch {
      recordingRef.current = null;
      setDeniedReason('Не удалось включить микрофон');
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      await configureAudioPlayback().catch(() => undefined);
      return false;
    }

    // Запись уже пишется в recordingRef — только теперь помечаем сессию активной,
    // чтобы stop() во время подготовки не оставил осиротевший рекордер.
    activeRef.current = true;
    setTalking(true);
    if (!holdRef.current) stop();
    return true;
  }, [channel, enabled, stop]);

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

  return { talking, deniedReason, start, stop };
}
