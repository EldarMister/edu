import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { PTT_EVENTS, type PttChannel, type PttDeniedPayload } from './types';

const SEGMENT_MS = 250;

type Ack = { ok: boolean; reason?: string };

function pickMimeType() {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const comma = value.indexOf(',');
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать аудио'));
    reader.readAsDataURL(blob);
  });
}

function socketAck(event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    getSocket().emit(event, payload, (ack: Ack | undefined) => resolve(ack ?? { ok: false }));
  });
}

export function useAudioPttSender(channel: PttChannel, enabled: boolean) {
  const [talking, setTalking] = useState(false);
  const [deniedReason, setDeniedReason] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeRef = useRef(false);
  const holdRef = useRef(false);
  const seqRef = useRef(0);

  const cleanupStream = useCallback(() => {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    holdRef.current = false;
    if (!activeRef.current) return;
    activeRef.current = false;
    setTalking(false);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    cleanupStream();
    getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
  }, [channel, cleanupStream]);

  const recordSegment = useCallback(async () => {
    const stream = streamRef.current;
    if (!activeRef.current || !stream) return;

    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      const currentSeq = seqRef.current++;
      void blobToBase64(blob)
        .then((chunk) => {
          if (!chunk) return;
          getSocket().emit(PTT_EVENTS.CHUNK, {
            channel,
            mimeType: blob.type || recorder.mimeType || 'audio/webm',
            seq: currentSeq,
            chunk,
          });
        })
        .finally(() => {
          if (activeRef.current) void recordSegment();
        });
    };
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, SEGMENT_MS);
  }, [channel]);

  const start = useCallback(async () => {
    if (!enabled || activeRef.current) return false;
    holdRef.current = true;
    setDeniedReason(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setDeniedReason('Микрофон недоступен');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ack = await socketAck(PTT_EVENTS.START_TALK, { channel });
      if (!ack.ok) {
        stream.getTracks().forEach((track) => track.stop());
        setDeniedReason(ack.reason === 'busy' ? 'Канал занят' : 'Не удалось начать разговор');
        return false;
      }
      if (!holdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        getSocket().emit(PTT_EVENTS.STOP_TALK, { channel });
        return false;
      }
      streamRef.current = stream;
      activeRef.current = true;
      seqRef.current = 0;
      setTalking(true);
      void recordSegment();
      return true;
    } catch {
      setDeniedReason('Разрешите доступ к микрофону');
      stop();
      return false;
    }
  }, [channel, enabled, recordSegment, stop]);

  useEffect(() => {
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

  useEffect(() => () => stop(), [stop]);

  return { talking, deniedReason, start, stop };
}
