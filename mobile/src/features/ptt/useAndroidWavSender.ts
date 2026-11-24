import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Audio } from 'expo-av';
import { getSocket } from '@/services/socket';
import { wavCapture } from './androidWavRadio';
import { startRadioInput } from './radioAudioGate';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload } from './types';

type Socket = ReturnType<typeof getSocket>;
type Attempt = {
  socket: Socket;
  connection?: string;
  channel: PttChannel;
  releaseInput: () => void;
  cancelled: boolean;
  awaitingGrant: boolean;
  granted: boolean;
  token?: number;
  sequence: number;
  subscriptions: { remove(): void }[];
  polling?: ReturnType<typeof setInterval>;
};
let nextCaptureToken = Date.now();

function connected(attempt: Attempt) {
  return attempt.socket.connected && attempt.socket.id === attempt.connection;
}

function sendChunk(attempt: Attempt, chunk: string | null) {
  if (chunk && connected(attempt)) attempt.socket.emit(PTT_EVENTS.NATIVE_CHUNK, {
    channel: attempt.channel, mimeType: 'audio/wav', seq: attempt.sequence++, chunk,
  });
}

export function useAndroidWavSender(channel: PttChannel, enabled: boolean) {
  const current = useRef<Attempt | null>(null);
  const [talking, setTalking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [deniedReason, setDeniedReason] = useState<string | null>(null);

  const finish = useCallback((attempt: Attempt) => {
    if (current.current !== attempt) return;
    current.current = null;
    setTalking(false);
    setPreparing(false);
    clearInterval(attempt.polling);
    attempt.subscriptions.forEach((subscription) => subscription.remove());
    try {
      if (attempt.token !== undefined) wavCapture?.finish(attempt.token).forEach((chunk) => sendChunk(attempt, chunk));
    } catch {
      setDeniedReason('Не удалось передать окончание фразы');
    } finally {
      if (attempt.granted && connected(attempt)) attempt.socket.emit(PTT_EVENTS.STOP_TALK, { channel: attempt.channel });
      attempt.releaseInput();
    }
  }, []);

  const stop = useCallback(() => {
    const attempt = current.current;
    if (!attempt) return;
    attempt.cancelled = true;
    setPreparing(false);
    // Keep this attempt until the acknowledgement arrives. A late grant still has to be released.
    if (!attempt.awaitingGrant) finish(attempt);
  }, [finish]);

  const start = useCallback(async () => {
    if (!enabled || !wavCapture || current.current) return false;
    const capture = wavCapture;
    const socket = getSocket();
    if (!socket.connected) {
      setDeniedReason('Рация подключается. Попробуйте ещё раз');
      return false;
    }
    const attempt: Attempt = {
      socket, connection: socket.id, channel, releaseInput: startRadioInput(), cancelled: false,
      awaitingGrant: false, granted: false, sequence: 0, subscriptions: [],
    };
    current.current = attempt;
    setDeniedReason(null);
    setPreparing(true);
    try {
      const existing = await Audio.getPermissionsAsync();
      if (current.current !== attempt) return false;
      const permission = existing.granted ? existing : await Audio.requestPermissionsAsync();
      if (current.current !== attempt) return false;
      if (!permission.granted) {
        setDeniedReason('Разрешите доступ к микрофону');
        finish(attempt);
        return false;
      }
      attempt.awaitingGrant = true;
      const ack: { ok?: boolean; reason?: string } = await socket.timeout(3500).emitWithAck(PTT_EVENTS.START_TALK, { channel });
      attempt.awaitingGrant = false;
      if (current.current !== attempt) {
        if (ack.ok && connected(attempt)) socket.emit(PTT_EVENTS.STOP_TALK, { channel });
        return false;
      }
      attempt.granted = ack.ok === true;
      if (!attempt.granted || attempt.cancelled) {
        if (!attempt.cancelled) setDeniedReason(ack.reason === 'busy' ? 'Канал занят' : 'Не удалось начать разговор');
        finish(attempt);
        return false;
      }
      const token = attempt.token = ++nextCaptureToken;
      function drain() {
        if (current.current !== attempt || !connected(attempt)) return;
        try { sendChunk(attempt, capture.take(token)); }
        catch {
          setDeniedReason('Передача прервалась. Повторите фразу');
          finish(attempt);
        }
      }
      attempt.subscriptions.push(
        capture.addListener('onChunkReady', (event) => { if (event.token === token) drain(); }),
        capture.addListener('onCaptureEnded', (event) => {
          if (event.token !== token || current.current !== attempt) return;
          setDeniedReason('Запись с микрофона прервалась');
          finish(attempt);
        }),
      );
      const opened = await capture.start(token);
      if (current.current !== attempt) return false;
      if (!opened) throw new Error('Radio microphone did not start');
      attempt.polling = setInterval(drain, 1000);
      setPreparing(false);
      setTalking(true);
      return true;
    } catch {
      if (current.current === attempt) {
        if (!attempt.cancelled) setDeniedReason('Не удалось начать или продолжить передачу');
        // The lock may have been granted before its acknowledgement timed out.
        if (attempt.awaitingGrant) attempt.granted = true;
        finish(attempt);
      }
      return false;
    }
  }, [channel, enabled, finish]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const denied = (payload: PttDeniedPayload) => {
      if (!current.current || (payload.channel && payload.channel !== channel) || !current.current.granted) return;
      setDeniedReason('Передача прервалась. Повторите фразу');
      finish(current.current);
    };
    const disconnect = () => {
      if (!current.current) return;
      setDeniedReason('Связь прервалась. Повторите фразу после подключения');
      finish(current.current);
    };
    const state = AppState.addEventListener('change', (value) => { if (value !== 'active') stop(); });
    socket.on(PTT_EVENTS.TALK_DENIED, denied);
    socket.on('disconnect', disconnect);
    return () => {
      state.remove();
      socket.off(PTT_EVENTS.TALK_DENIED, denied);
      socket.off('disconnect', disconnect);
      if (current.current) finish(current.current);
    };
  }, [channel, enabled, finish, stop]);

  return { talking, preparing, deniedReason, start, stop };
}
