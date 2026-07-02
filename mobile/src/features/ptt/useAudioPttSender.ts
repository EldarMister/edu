import React from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { getSocket } from '@/services/socket';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload } from './types';

const SEGMENT_MS = 420;
const MIME_TYPE = 'audio/mp4';

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

function socketAck(event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    getSocket().emit(event, payload, (ack: Ack | undefined) => resolve(ack ?? { ok: false }));
  });
}

async function configureRecordingAudio() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

async function configurePlaybackAudio() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
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
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = React.useRef(0);
  const finishSegmentRef = React.useRef<(continueLoop: boolean) => Promise<void>>(async () => undefined);

  const clearTimer = React.useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const recordSegment = React.useCallback(async () => {
    if (!activeRef.current || recordingRef.current || finishingRef.current) return;
    const recording = new Audio.Recording();
    recordingRef.current = recording;
    try {
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();
      timerRef.current = setTimeout(() => {
        void finishSegmentRef.current(true);
      }, SEGMENT_MS);
    } catch {
      recordingRef.current = null;
      activeRef.current = false;
      setTalking(false);
      setDeniedReason('Не удалось включить микрофон');
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      await configurePlaybackAudio().catch(() => undefined);
    }
  }, [channel]);

  const finishSegment = React.useCallback(async (continueLoop: boolean) => {
    if (finishingRef.current) return;
    const recording = recordingRef.current;
    if (!recording) return;
    finishingRef.current = true;
    clearTimer();
    recordingRef.current = null;
    let uri: string | null = null;
    try {
      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
      if (uri) {
        const chunk = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (chunk) {
          getSocket().emit(PTT_EVENTS.CHUNK, {
            channel,
            mimeType: MIME_TYPE,
            seq: seqRef.current,
            chunk,
          });
          seqRef.current += 1;
        }
      }
    } catch {
      // Android can throw E_AUDIO_NODATA when stopped too early. Discard that segment.
    } finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      finishingRef.current = false;
      if (activeRef.current && continueLoop) void recordSegment();
    }
  }, [channel, clearTimer, recordSegment]);
  finishSegmentRef.current = finishSegment;

  const stop = React.useCallback(() => {
    holdRef.current = false;
    if (!activeRef.current && !recordingRef.current) return;
    activeRef.current = false;
    setTalking(false);
    void finishSegmentRef.current(false).finally(() => {
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      void configurePlaybackAudio().catch(() => undefined);
    });
  }, [channel]);

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
      await configurePlaybackAudio().catch(() => undefined);
      return false;
    }
    if (!holdRef.current) {
      getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
      await configurePlaybackAudio().catch(() => undefined);
      return false;
    }
    seqRef.current = 0;
    activeRef.current = true;
    setTalking(true);
    void recordSegment();
    return true;
  }, [channel, enabled, recordSegment]);

  React.useEffect(() => {
    const sock = getSocket();
    const onDenied = (payload: PttDeniedPayload) => {
      if (payload.channel && payload.channel !== channel) return;
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
