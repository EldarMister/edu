import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { PTT_EVENTS, type PttAudioPayload, type PttChannel } from './types';

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function playHtmlAudio(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const done = () => URL.revokeObjectURL(url);
    audio.onended = () => {
      done();
      resolve();
    };
    audio.onerror = () => {
      done();
      reject(new Error('Не удалось воспроизвести аудио'));
    };
    audio.play().catch((error) => {
      done();
      reject(error);
    });
  });
}

export function useAudioPttReceiver(channel: PttChannel, enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  const [receiving, setReceiving] = useState(false);
  const queueRef = useRef<PttAudioPayload[]>([]);
  const playingRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);

  const playPayload = useCallback(async (payload: PttAudioPayload) => {
  const bytes = base64ToBytes(payload.chunk);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([data], { type: payload.mimeType || 'application/octet-stream' });
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) throw new Error('AudioContext недоступен');
      const ctx = ctxRef.current ?? new AudioCtx();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => resolve();
        source.start();
      });
    } catch {
      await playHtmlAudio(blob);
    }
  }, []);

  const pump = useCallback(() => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setReceiving(false);
      return;
    }
    playingRef.current = true;
    setReceiving(true);
    void playPayload(next)
      .catch(() => undefined)
      .finally(() => {
        playingRef.current = false;
        pump();
      });
  }, [playPayload]);

  useEffect(() => {
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
