import React from 'react';
import { AppState } from 'react-native';
import { Audio } from 'expo-av';
import { randomUUID } from 'expo-crypto';
import { configureAudioRecording } from '@/lib/sound';
import { getSocket } from '@/services/socket';
import type { Workspace } from '@/lib/workspaces';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload } from './types';
import { configureRadioAudioSession, startRadioCapture } from './nativeAudio';
import { createOpusEncoder, type OpusMode } from './opusAudio';
import { playPttCue } from './sounds';

type Socket = ReturnType<typeof getSocket>;
type Ack = { ok: boolean; reason?: string; talkId?: string; codec?: OpusMode };
type Attempt = {
  socket: Socket;
  channel: PttChannel;
  talkId: string;
  requested: boolean;
  granted: boolean;
  released: boolean;
  cue: AbortController;
  configuring?: Promise<void>;
  capture?: ReturnType<typeof startRadioCapture>;
  encoder?: ReturnType<typeof createOpusEncoder>;
  firstAudioTimeout?: ReturnType<typeof setTimeout>;
  pending: Float32Array[];
};
const MAX_PENDING_FRAMES = 200;

function releaseChannel({ socket, channel, talkId }: Attempt) {
  if (socket.connected) socket.emit(PTT_EVENTS.STOP_TALK, { channel, talkId });
}

function requestChannel({ socket, channel, talkId }: Attempt) {
  return new Promise<Ack>((resolve) => {
    socket.timeout(3500).emit(PTT_EVENTS.START_TALK, { channel, talkId, codec: 'opus', preferHq: true }, (error: Error | null, ack?: Ack) =>
      resolve(error ? { ok: false, reason: 'timeout' } : ack ?? { ok: false }));
  });
}

export function useAudioPttSender(channel: PttChannel, enabled: boolean, workspace: Workspace | null = null) {
  const [talking, setTalking] = React.useState(false);
  const [preparing, setPreparing] = React.useState(false);
  const [deniedReason, setDeniedReason] = React.useState<string | null>(null);
  const attemptRef = React.useRef<Attempt | null>(null);
  const stoppingRef = React.useRef(false);

  const finish = React.useCallback((attempt: Attempt) => {
    if (attemptRef.current !== attempt) return;
    attemptRef.current = null;
    setTalking(false);
    setPreparing(false);
    attempt.cue.abort();
    clearTimeout(attempt.firstAudioTimeout);
    attempt.encoder?.close();
    if (attempt.requested) releaseChannel(attempt);

    if (attempt.configuring) {
      stoppingRef.current = true;
      void (async () => {
        try {
          await attempt.configuring?.catch(() => undefined);
          await attempt.capture?.stop();
          configureRadioAudioSession(false);
        } finally {
          await configureAudioRecording(false).catch(() => undefined);
          stoppingRef.current = false;
        }
      })().catch(() => undefined);
    }
  }, []);

  const fail = React.useCallback((attempt: Attempt, message: string) => {
    if (attemptRef.current !== attempt) return;
    setDeniedReason(message);
    finish(attempt);
  }, [finish]);

  const complete = React.useCallback((attempt: Attempt) => {
    try {
      attempt.encoder?.flush();
      finish(attempt);
    } catch {
      fail(attempt, 'Не удалось передать конец фразы. Повторите последние слова');
    }
  }, [fail, finish]);

  const stop = React.useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt || attempt.released) return;
    attempt.released = true;
    attempt.cue.abort();
    setTalking(false);
    setPreparing(false);
    clearTimeout(attempt.firstAudioTimeout);
    const capture = attempt.capture;
    if (!capture) {
      finish(attempt);
      return;
    }
    void capture.stop()
      .catch(() => false)
      .then((flushed) => {
        if (attemptRef.current !== attempt) return;
        attempt.capture = undefined;
        if (!flushed) setDeniedReason('Не удалось передать конец фразы. Повторите последние слова');
        if (attempt.granted) complete(attempt);
      });
  }, [complete, finish]);

  const start = React.useCallback(async () => {
    if (!enabled || attemptRef.current || stoppingRef.current) return false;
    setDeniedReason(null);
    const socket = getSocket();
    if (!socket.connected) {
      setDeniedReason('Рация подключается. Попробуйте ещё раз');
      return false;
    }
    const attempt: Attempt = {
      socket, channel, talkId: randomUUID(), requested: false, granted: false, released: false,
      cue: new AbortController(), pending: [],
    };
    attemptRef.current = attempt;
    setPreparing(true);
    // The local acknowledgement must never delay capture or the channel request.
    void playPttCue('start', attempt.cue.signal).catch(() => undefined);
    try {
      const current = await Audio.getPermissionsAsync();
      if (attemptRef.current !== attempt) return false;
      const permission = current.granted ? current : await Audio.requestPermissionsAsync();
      if (attemptRef.current !== attempt) return false;
      if (!permission.granted) {
        fail(attempt, 'Разрешите доступ к микрофону');
        return false;
      }

      attempt.configuring = configureAudioRecording(true);
      await attempt.configuring;
      if (attemptRef.current !== attempt) return false;
      configureRadioAudioSession(true);

      // Capture before the grant so a delayed acknowledgement doesn't cut off the first words.
      // Keep the microphone samples until the server confirms the codec for this talk.
      attempt.firstAudioTimeout = setTimeout(() => fail(attempt, 'Микрофон рации не передаёт звук'), 1200);
      attempt.capture = startRadioCapture((samples) => {
        if (attemptRef.current !== attempt) return;
        clearTimeout(attempt.firstAudioTimeout);
        if (!attempt.granted) {
          if (attempt.pending.length < MAX_PENDING_FRAMES) attempt.pending.push(samples);
          else fail(attempt, 'Канал отвечает слишком долго. Повторите фразу');
          return;
        }
        try { attempt.encoder?.push(samples); }
        catch { fail(attempt, 'Не удалось передать звук. Повторите фразу'); }
      });
      attempt.requested = true;
      const ack = await requestChannel(attempt);
      if (attemptRef.current !== attempt) {
        if (ack.ok) releaseChannel(attempt);
        return false;
      }
      if (!ack.ok || ack.talkId !== attempt.talkId || (ack.codec !== 'opus' && ack.codec !== 'opus-hq')) {
        fail(attempt, ack.reason === 'busy' ? 'Канал занят' : ack.ok
          ? 'Обновите EDU POS, чтобы включить рацию' : 'Не удалось начать разговор');
        return false;
      }
      const encoder = attempt.encoder = createOpusEncoder(attempt.talkId, (packet) => {
        if (socket.connected && attemptRef.current === attempt) socket.emit(PTT_EVENTS.AUDIO_PACKET, packet);
      }, ack.codec);
      attempt.granted = true;
      for (const samples of attempt.pending) encoder.push(samples);
      attempt.pending.length = 0;
      if (attempt.released) {
        if (!attempt.capture) complete(attempt);
        return false;
      }
      setPreparing(false);
      setTalking(true);
      return true;
    } catch {
      fail(attempt, 'Не удалось запустить микрофон рации');
      return false;
    }
  }, [channel, enabled, complete, fail]);

  React.useEffect(() => {
    const socket = getSocket();
    function onDenied(payload: PttDeniedPayload) {
      const attempt = attemptRef.current;
      if (attempt && payload.talkId === attempt.talkId) fail(attempt, 'Передача прервалась. Повторите фразу');
    }
    function onDisconnect() {
      const attempt = attemptRef.current;
      if (attempt) fail(attempt, 'Связь прервалась. Повторите фразу после подключения');
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') stop();
    });
    socket.on(PTT_EVENTS.TALK_DENIED, onDenied);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off(PTT_EVENTS.TALK_DENIED, onDenied);
      socket.off('disconnect', onDisconnect);
      subscription.remove();
      if (attemptRef.current) finish(attemptRef.current);
    };
  }, [channel, enabled, fail, finish, stop, workspace]);

  return { talking, preparing, deniedReason, start, stop };
}
