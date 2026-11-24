import React from 'react';
import { AppState } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { getSocket } from '@/services/socket';
import { useAuth } from '@/store/auth';
import { PTT_EVENTS, type PttAudioPayload, type PttChannel } from './types';

const stream = requireOptionalNativeModule<{
  begin(session: string): void;
  enqueue(session: string, packet: string): Promise<boolean>;
  remaining(session: string): number;
  stop(session: string): void;
}>('EduRadioPlayback');
let nextSession = 0;

function extensionForMime(mimeType: string) {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'm4a';
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

async function playFile(uri: string, signal: AbortSignal, expectProgress: (ms: number) => void) {
  if (signal.aborted) return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
  const { sound, status: loaded } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, volume: 1, progressUpdateIntervalMillis: 100 },
  );
  let finish: (() => void) | undefined;
  try {
    if (signal.aborted) return;
    expectProgress((loaded?.isLoaded ? loaded.durationMillis ?? 2000 : 2000) + 1200);
    await new Promise<void>((resolve, reject) => {
      finish = () => resolve();
      signal.addEventListener('abort', finish);
      let observedPosition = 0;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (signal.aborted) return;
        if (!status.isLoaded) {
          if ('error' in status && status.error) reject(new Error(status.error));
          return;
        }
        if (status.didJustFinish) resolve();
        else if (status.positionMillis > observedPosition) {
          observedPosition = status.positionMillis;
          expectProgress((status.durationMillis == null ? 2000 : Math.max(0, status.durationMillis - observedPosition)) + 1200);
        }
      });
      sound.playAsync().catch(reject);
    });
  } finally {
    if (finish) signal.removeEventListener('abort', finish);
    sound.setOnPlaybackStatusUpdate(null);
    await sound.unloadAsync().catch(() => undefined);
  }
}

export function useAudioPttReceiver(channel: PttChannel, enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  const [receiving, setReceiving] = React.useState(false);
  React.useEffect(() => {
    setReceiving(false);
    if (!enabled || !userId) return;
    const sock = getSocket();
    const queue: PttAudioPayload[] = [];
    let controller = new AbortController();
    let session = String(++nextSession);
    let nativeOpen = false;
    let playing = false;
    let foreground = AppState.currentState !== 'background';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let drainBy = 0;

    function stopNative() {
      const wasOpen = nativeOpen;
      nativeOpen = false;
      if (wasOpen) {
        try { stream?.stop(session); } catch { /* The native activity may already be gone. */ }
      }
    }
    function reset() {
      clearTimeout(timer);
      clearTimeout(watchdog);
      drainBy = 0;
      controller.abort();
      controller = new AbortController();
      stopNative();
      session = String(++nextSession);
      queue.length = 0;
      playing = false;
      setReceiving(false);
    }
    function expectProgress(ms: number) {
      clearTimeout(watchdog);
      watchdog = setTimeout(reset, ms);
    }
    function nativeRemaining() {
      if (!nativeOpen) return 0;
      try { return stream?.remaining(session) ?? 0; } catch { stopNative(); return 0; }
    }
    function remaining() {
      if (Date.now() >= drainBy) return 0;
      return Math.min(drainBy - Date.now(), nativeRemaining());
    }
    function observeTail() {
      const ms = remaining();
      if (ms > 0) timer = setTimeout(observeTail, Math.max(12, Math.min(ms, 60)));
      else {
        setReceiving(false);
        // Keep the track through short network gaps, then release its hardware buffer.
        if (nativeOpen) timer = setTimeout(stopNative, 450);
      }
    }
    async function play(payload: PttAudioPayload, signal: AbortSignal) {
      if (stream && payload.mimeType.toLowerCase().includes('wav')) {
        try {
          if (!nativeOpen) { stream.begin(session); nativeOpen = true; }
          if (await stream.enqueue(session, payload.chunk)) {
            if (!signal.aborted) drainBy = Date.now() + Math.min(nativeRemaining(), 2000) + 800;
            return;
          }
        } catch {
          // Platform initialization or codecs outside PCM16 can use expo-av.
        }
      }
      while (!signal.aborted && remaining() > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      if (signal.aborted) return;
      stopNative();
      const path = await writeChunkToFile(payload);
      try { await playFile(path, signal, expectProgress); }
      finally { await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined); }
    }
    async function pump(signal: AbortSignal) {
      playing = true;
      try {
        while (!signal.aborted && queue.length) {
          const payload = queue.shift()!;
          // A WAV is at least 8 kHz PCM16 mono. Even if a native promise never settles,
          // allow its full possible duration plus device startup before releasing push-to-talk.
          const isWave = payload.mimeType.toLowerCase().includes('wav');
          expectProgress(isWave ? 1600 + Math.ceil(payload.chunk.length * 0.75 / 16) : 6000);
          try { await play(payload, signal); } catch { /* An unreadable packet must not block the next one. */ }
          finally { if (!signal.aborted) clearTimeout(watchdog); }
        }
      } finally {
        if (!signal.aborted) { playing = false; observeTail(); }
      }
    }
    const onAudio = (payload: PttAudioPayload) => {
      if (!foreground || (payload.channel !== channel && payload.channel !== 'general') || payload.senderId === userId) return;
      clearTimeout(timer);
      queue.push(payload);
      setReceiving(true);
      if (!playing) void pump(controller.signal);
    };
    const visibility = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (!foreground) reset();
    });
    sock.on(PTT_EVENTS.AUDIO_STREAM, onAudio);
    return () => {
      visibility.remove();
      sock.off(PTT_EVENTS.AUDIO_STREAM, onAudio);
      reset();
    };
  }, [channel, enabled, userId]);

  return { receiving };
}
