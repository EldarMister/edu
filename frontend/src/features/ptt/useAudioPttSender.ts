import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { setAudioRecording, unlockAudio } from '@/lib/audio';
import { createPttCapture, playPttReadyCue } from './liveAudio';
import { createPttOpusEncoder, isPttOpusCodec } from './opusAudio';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload, type PttOpusCodec } from './types';

type Socket = ReturnType<typeof getSocket>;
type Ack = { ok: boolean; reason?: string; talkId?: string; codec?: PttOpusCodec };
type Transmission = {
  talkId: string;
  channel: PttChannel;
  socket: Socket;
  stream?: MediaStream;
  capture?: Awaited<ReturnType<typeof createPttCapture>>;
  encoder?: Awaited<ReturnType<typeof createPttOpusEncoder>>;
  requested: boolean;
  granted: boolean;
  released: boolean;
  pendingFrames: ArrayBuffer[];
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
    socket.timeout(3500).emit(PTT_EVENTS.START_TALK, { channel, talkId, codec: 'opus', preferHq: true }, (error: Error | null, ack?: Ack) =>
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
    stopTracks(attempt.stream);
    attempt.capture?.close();
    attempt.encoder?.close();
    setAudioRecording(false);
    setStarting(false);
    setTalking(false);
    if (attempt.requested) releaseChannel(attempt);
  }, []);

  const complete = useCallback((attempt: Transmission) => {
    try {
      attempt.encoder?.flush();
    } catch {
      setDeniedReason('Не удалось передать конец фразы. Повторите последние слова');
    }
    finish();
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
      if (attempt.granted) complete(attempt);
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
          try { attempt.encoder.push(audio); } catch { fail('Не удалось передать звук. Повторите фразу'); }
        } else if (attempt.pendingFrames.length < MAX_PENDING_FRAMES) attempt.pendingFrames.push(audio);
        else fail('Канал отвечает слишком долго. Повторите фразу');
      }, () => fail('Передача прервалась. Попробуйте ещё раз'));
      if (attemptRef.current !== attempt) {
        capture.close();
        return false;
      }
      attempt.capture = capture;
      capture.connect();
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

      const encoder = await createPttOpusEncoder(talkId, (packet) => {
        if (socket.connected && attemptRef.current === attempt) socket.emit(PTT_EVENTS.AUDIO_PACKET, packet);
      }, ack.codec);
      if (attemptRef.current !== attempt) {
        encoder.close();
        return false;
      }
      attempt.encoder = encoder;
      attempt.granted = true;
      for (const audio of attempt.pendingFrames) encoder.push(audio);
      attempt.pendingFrames.length = 0;
      if (attempt.released) {
        if (!attempt.capture) complete(attempt);
        return false;
      }
      setStarting(false);
      setTalking(true);
      playPttReadyCue();
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

    socket.on(PTT_EVENTS.TALK_DENIED, onDenied);
    socket.on('disconnect', onDisconnect);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', finish);
    return () => {
      socket.off(PTT_EVENTS.TALK_DENIED, onDenied);
      socket.off('disconnect', onDisconnect);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', finish);
      finish();
    };
  }, [channel, enabled, finish]);

  return { talking, starting, deniedReason, start, stop };
}
