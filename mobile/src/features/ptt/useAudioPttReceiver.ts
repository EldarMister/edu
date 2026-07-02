import React from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { getSocket } from '@/services/socket';
import { useAuth } from '@/store/auth';
import { PTT_EVENTS, type PttAudioPayload, type PttChannel } from './types';

function extensionForMime(mimeType: string) {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mpeg')) return 'mp3';
  return 'm4a';
}

function writeChunkToFile(payload: PttAudioPayload): Promise<string> {
  const ext = extensionForMime(payload.mimeType);
  const path = `${FileSystem.cacheDirectory}ptt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  return FileSystem.writeAsStringAsync(path, payload.chunk, {
    encoding: FileSystem.EncodingType.Base64,
  }).then(() => path);
}

async function playFile(uri: string) {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
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

export function useAudioPttReceiver(channel: PttChannel, enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  const [receiving, setReceiving] = React.useState(false);
  const queueRef = React.useRef<PttAudioPayload[]>([]);
  const playingRef = React.useRef(false);

  const pump = React.useCallback(() => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setReceiving(false);
      return;
    }
    playingRef.current = true;
    setReceiving(true);
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
        playingRef.current = false;
        pump();
      });
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      queueRef.current = [];
      setReceiving(false);
      return undefined;
    }

    const sock = getSocket();
    const onAudio = (payload: PttAudioPayload) => {
      if (payload.channel !== channel || payload.senderId === userId) return;
      queueRef.current.push(payload);
      pump();
    };
    sock.on(PTT_EVENTS.AUDIO_STREAM, onAudio);
    return () => {
      sock.off(PTT_EVENTS.AUDIO_STREAM, onAudio);
    };
  }, [channel, enabled, pump, userId]);

  return { receiving };
}
