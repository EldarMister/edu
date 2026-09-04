import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { playRadioAudio } from '@/lib/audio';
import { PTT_EVENTS, type PttAudioPayload, type PttChannel } from './types';

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type PttPlayingSpeaker = { id: string; name?: string; role?: string };

export function useAudioPttReceiver(channel: PttChannel, enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  const [receiving, setReceiving] = useState(false);
  const [speaker, setSpeaker] = useState<PttPlayingSpeaker | null>(null);
  const queueRef = useRef<PttAudioPayload[]>([]);
  const playingRef = useRef(false);

  // Каждое сообщение — цельный файл. Выравниваем громкость и воспроизводим
  // через тот же мультимедийный аудиовыход, что озвучку и уведомления.
  const playPayload = useCallback(async (payload: PttAudioPayload) => {
    const bytes = base64ToBytes(payload.chunk);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([data], { type: payload.mimeType || 'application/octet-stream' });
    await playRadioAudio(blob);
  }, []);

  const pump = useCallback(() => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setReceiving(false);
      setSpeaker(null);
      return;
    }
    playingRef.current = true;
    setReceiving(true);
    // Пока играет файл — канал занят этим говорящим (half-duplex: кнопка
    // блокируется на всё время воспроизведения, а не только пока держали).
    setSpeaker({ id: next.senderId, name: next.senderName, role: next.senderRole });
    void playPayload(next)
      .catch((error) => console.warn('[ptt] Не удалось воспроизвести сообщение:', error))
      .finally(() => {
        playingRef.current = false;
        pump();
      });
  }, [playPayload]);

  useEffect(() => {
    if (!enabled) {
      queueRef.current = [];
      setReceiving(false);
      setSpeaker(null);
      return undefined;
    }

    const sock = getSocket();
    const onAudio = (payload: PttAudioPayload) => {
      const audibleForCurrentChannel = payload.channel === channel || payload.channel === 'general';
      if (!audibleForCurrentChannel || payload.senderId === userId) return;
      queueRef.current.push(payload);
      pump();
    };
    sock.on(PTT_EVENTS.AUDIO_MESSAGE, onAudio);
    return () => {
      sock.off(PTT_EVENTS.AUDIO_MESSAGE, onAudio);
    };
  }, [channel, enabled, pump, userId]);

  return { receiving, speaker };
}
