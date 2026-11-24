import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { setAudioRecording, unlockAudio } from '@/lib/audio';
import { createPttCapture } from './liveAudio';
import { createPttOpusEncoder, isPttOpusCodec, PTT_OPUS_PROFILES } from './opusAudio';
import { playPttCue } from './sounds';
import { createPttBatcher, createPttNativeClips } from './sequencedAudio';
import { startRadioInput } from './radioAudioGate';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload, type PttOpusCodec } from './types';

type Socket = ReturnType<typeof getSocket>;
type Ack = { ok: boolean; reason?: string; talkId?: string; sequenced?: boolean; codec?: PttOpusCodec; nativePcm?: boolean };
type Transmission = {
  talkId: string;
  batcher?: ReturnType<typeof createPttBatcher>;
  releaseInput: () => void;
  cue: AbortController;
  channel: PttChannel;
  socket: Socket;
  stream?: MediaStream;
  capture?: Awaited<ReturnType<typeof createPttCapture>>;
  encoder?: Awaited<ReturnType<typeof createPttOpusEncoder>>;
  requested: boolean;
  granted: boolean;
  released: boolean;
  pendingFrames: ArrayBuffer[];
  nativeClips: ReturnType<typeof createPttNativeClips>;
};

// Keep up to 4 s of 20 ms capture frames while the channel grant is pending.
const MAX_PENDING_FRAMES = 200;

function stopTracks(stream?: MediaStream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function releaseChannel({ socket, channel, talkId }: Transmission) {
  if (socket.connected) socket.emit(PTT_EVENTS.STOP_TALK, { channel, talkId });
}

function requestChannel({ socket, channel, talkId }: Transmission): Promise<Ack> {
  return new Promise((resolve) => {
    socket.timeout(3500).emit(PTT_EVENTS.START_TALK, { channel, talkId, codec: 'opus', preferHq: true, sequenced: true, nativePcm: true }, (error: Error | null, ack?: Ack) =>
      resolve(error ? { ok: false, reason: 'timeout' } : ack ?? { ok: false }));
  });
}

export function useAudioPttSender(channel: PttChannel, enabled: boolean) {
  const [talking, setTalking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deniedReason, setDeniedReason] = useState<string | null>(null);
  const attemptRef = useRef<Transmission | null>(null);

  const finish = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt) return;
    attemptRef.current = null;
    attempt.cue.abort();
    attempt.releaseInput();
    stopTracks(attempt.stream);
    attempt.capture?.close();
    attempt.encoder?.close();
    setAudioRecording(false);
    setStarting(false);
    setTalking(false);
    if (attempt.requested) releaseChannel(attempt);
  }, []);

  const complete = useCallback(async (attempt: Transmission) => {
    try {
      attempt.encoder?.flush();
      if (attempt.batcher) {
        const frames = attempt.batcher.flush();
        attempt.nativeClips.flush();
        const response = await attempt.socket.timeout(4500).emitWithAck(PTT_EVENTS.STOP_TALK, {
          channel: attempt.channel, talkId: attempt.talkId, frames,
        });
        if (!response?.ok) throw new Error('Incomplete radio transmission');
        attempt.requested = false;
      }
    } catch {
      if (attemptRef.current === attempt) setDeniedReason('Не удалось передать конец фразы. Повторите последние слова');
    }
    if (attemptRef.current === attempt) finish();
  }, [finish]);

  const stop = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt || attempt.released) return;
    if (!attempt.capture) {
      finish();
      return;
    }

    attempt.released = true;
    stopTracks(attempt.stream);
    attempt.stream = undefined;
    setStarting(false);
    setTalking(false);
    const capture = attempt.capture;
    void capture.flush().then((flushed) => {
      if (attemptRef.current !== attempt) return;
      if (!flushed) setDeniedReason('Не удалось передать конец фразы. Повторите последние слова');
      capture.close();
      attempt.capture = undefined;
      attempt.releaseInput();
      if (attempt.granted) void complete(attempt);
      else setAudioRecording(false);
    });
  }, [complete, finish]);

  const start = useCallback(async () => {
    if (!enabled || attemptRef.current) return false;
    setDeniedReason(null);
    unlockAudio();

    const socket = getSocket();
    if (!socket.connected) {
      setDeniedReason('Рация подключается. Попробуйте ещё раз');
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      setDeniedReason('Микрофон рации недоступен в этом браузере');
      return false;
    }

    const talkId = crypto.randomUUID();
    const attempt: Transmission = {
      talkId, channel, socket, requested: false, granted: false, released: false, pendingFrames: [],
      cue: new AbortController(), releaseInput: startRadioInput(),
      nativeClips: createPttNativeClips((firstSample, audio) => {
        if (socket.connected) socket.emit(PTT_EVENTS.NATIVE_PCM, { channel, talkId, firstSample, audio });
      }),
    };
    attemptRef.current = attempt;
    setAudioRecording(true);
    setStarting(true);
    const fail = (message: string) => {
      if (attemptRef.current !== attempt) return;
      setDeniedReason(message);
      finish();
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (attemptRef.current !== attempt) {
        stopTracks(stream);
        return false;
      }
      attempt.stream = stream;
      stream.getAudioTracks()[0]?.addEventListener('ended', () => fail('Микрофон отключился'));
      const capture = await createPttCapture(stream, (audio) => {
        if (attemptRef.current !== attempt) return;
        if (attempt.encoder) {
          try {
            attempt.encoder.push(audio);
            attempt.nativeClips.push(audio);
          } catch { fail('Не удалось передать звук. Повторите фразу'); }
        } else if (attempt.pendingFrames.length < MAX_PENDING_FRAMES) attempt.pendingFrames.push(audio);
        else fail('Канал отвечает слишком долго. Повторите фразу');
      }, () => fail('Передача прервалась. Попробуйте ещё раз'));
      if (attemptRef.current !== attempt) {
        capture.close();
        return false;
      }
      attempt.capture = capture;
      capture.connect();
      // Start collecting speech before the ready tone or the network can hold up the first word.
      void playPttCue('start', 'sender', { signal: attempt.cue.signal, timeoutMs: 400 });
      attempt.requested = true;
      const ack = await requestChannel(attempt);
      if (attemptRef.current !== attempt) {
        // The grant may arrive after this attempt was cancelled.
        if (ack.ok) releaseChannel(attempt);
        return false;
      }
      if (!ack.ok || ack.talkId !== talkId || !isPttOpusCodec(ack.codec)) {
        fail(ack.reason === 'busy' ? 'Канал занят' : ack.ok ? 'Обновите EDU POS, чтобы включить рацию' : 'Не удалось начать разговор');
        return false;
      }

      if (ack.sequenced) {
        if (ack.nativePcm) attempt.nativeClips.enable();
        attempt.batcher = createPttBatcher(PTT_OPUS_PROFILES[ack.codec].frameBytes, (firstFrame, audio) => {
          socket.emit(PTT_EVENTS.AUDIO_BATCH, { channel, talkId, firstFrame, audio });
        });
      }
      const encoder = await createPttOpusEncoder(talkId, (packet) => {
        if (!socket.connected || attemptRef.current !== attempt) return;
        if (attempt.batcher) attempt.batcher.push(packet);
        else socket.emit(PTT_EVENTS.AUDIO_PACKET, packet);
      }, ack.codec);
      if (attemptRef.current !== attempt) {
        encoder.close();
        return false;
      }
      attempt.encoder = encoder;
      attempt.granted = true;
      for (const audio of attempt.pendingFrames) {
        encoder.push(audio);
        attempt.nativeClips.push(audio);
      }
      attempt.pendingFrames.length = 0;
      if (attempt.released) {
        if (!attempt.capture) void complete(attempt);
        return false;
      }
      setStarting(false);
      setTalking(true);
      return true;
    } catch (error) {
      fail(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Разрешите доступ к микрофону' : 'Не удалось запустить микрофон рации');
      return false;
    }
  }, [channel, enabled, complete, finish]);

  useEffect(() => {
    const socket = getSocket();
    const onDenied = (payload: PttDeniedPayload) => {
      if (!payload.talkId || payload.talkId !== attemptRef.current?.talkId) return;
      setDeniedReason('Передача прервалась. Повторите фразу');
      finish();
    };
    const onDisconnect = () => {
      if (!attemptRef.current) return;
      setDeniedReason('Связь прервалась. Повторите фразу после подключения');
      finish();
    };
    const onVisibility = () => { if (document.hidden) finish(); };
    const onNativeListener = ({ talkId }: { talkId: string }) => {
      if (attemptRef.current?.talkId === talkId) attemptRef.current.nativeClips.enable();
    };

    socket.on(PTT_EVENTS.NATIVE_LISTENER, onNativeListener);
    socket.on(PTT_EVENTS.TALK_DENIED, onDenied);
    socket.on('disconnect', onDisconnect);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', finish);
    return () => {
      socket.off(PTT_EVENTS.NATIVE_LISTENER, onNativeListener);
      socket.off(PTT_EVENTS.TALK_DENIED, onDenied);
      socket.off('disconnect', onDisconnect);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', finish);
      finish();
    };
  }, [channel, enabled, finish]);

  return { talking, starting, deniedReason, start, stop };
}
