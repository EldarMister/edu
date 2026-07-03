import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { PTT_EVENTS, type PttAudioPayload, type PttChannel } from './types';

const RECEIVE_IDLE_MS = 900;

type MsePlayer = {
  audio: HTMLAudioElement;
  mediaSource: MediaSource;
  sourceBuffer: SourceBuffer | null;
  url: string;
  mimeType: string;
  senderId: string;
  queue: Uint8Array[];
  open: boolean;
};

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function mseMimeType(mimeType: string) {
  if (mimeType.includes('webm')) return 'audio/webm;codecs=opus';
  return null;
}

function canUseMse(mimeType: string) {
  const sourceType = mseMimeType(mimeType);
  return typeof MediaSource !== 'undefined' && !!sourceType && MediaSource.isTypeSupported(sourceType);
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
  const mseRef = useRef<MsePlayer | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current === null) return;
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }, []);

  const markReceiving = useCallback(() => {
    setReceiving(true);
    clearIdleTimer();
    idleTimerRef.current = window.setTimeout(() => setReceiving(false), RECEIVE_IDLE_MS);
  }, [clearIdleTimer]);

  const destroyMse = useCallback(() => {
    const player = mseRef.current;
    mseRef.current = null;
    if (!player) return;
    try {
      if (player.mediaSource.readyState === 'open') player.mediaSource.endOfStream();
    } catch {
      // The stream may already be closed by the browser.
    }
    player.audio.pause();
    player.audio.removeAttribute('src');
    URL.revokeObjectURL(player.url);
  }, []);

  const flushMse = useCallback((player: MsePlayer) => {
    if (!player.open || !player.sourceBuffer || player.sourceBuffer.updating) return;
    const next = player.queue.shift();
    if (!next) return;
    try {
      const data = next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer;
      player.sourceBuffer.appendBuffer(data);
    } catch {
      destroyMse();
    }
  }, [destroyMse]);

  const appendMsePayload = useCallback((payload: PttAudioPayload, bytes: Uint8Array) => {
    const sourceType = mseMimeType(payload.mimeType);
    if (!sourceType) return false;

    let player = mseRef.current;
    if (!player || player.senderId !== payload.senderId || player.mimeType !== sourceType || payload.seq === 0) {
      destroyMse();
      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      const audio = new Audio(url);
      audio.autoplay = true;
      player = {
        audio,
        mediaSource,
        sourceBuffer: null,
        url,
        mimeType: sourceType,
        senderId: payload.senderId,
        queue: [],
        open: false,
      };
      mseRef.current = player;
      mediaSource.addEventListener('sourceopen', () => {
        const current = mseRef.current;
        if (!current || current !== player) return;
        try {
          current.sourceBuffer = mediaSource.addSourceBuffer(sourceType);
          current.sourceBuffer.mode = 'sequence';
          current.sourceBuffer.addEventListener('updateend', () => flushMse(current));
          current.open = true;
          flushMse(current);
          void audio.play().catch(() => undefined);
        } catch {
          destroyMse();
        }
      });
    }

    player.queue.push(bytes);
    flushMse(player);
    void player.audio.play().catch(() => undefined);
    return true;
  }, [destroyMse, flushMse]);

  const playPayload = useCallback(async (payload: PttAudioPayload) => {
    const bytes = base64ToBytes(payload.chunk);
    if (canUseMse(payload.mimeType) && appendMsePayload(payload, bytes)) return;

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
  }, [appendMsePayload]);

  const pump = useCallback(() => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setReceiving(false);
      return;
    }
    playingRef.current = true;
    markReceiving();
    void playPayload(next)
      .catch(() => undefined)
      .finally(() => {
        playingRef.current = false;
        pump();
      });
  }, [markReceiving, playPayload]);

  useEffect(() => {
    if (!enabled) {
      queueRef.current = [];
      setReceiving(false);
      destroyMse();
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
      clearIdleTimer();
      destroyMse();
    };
  }, [channel, clearIdleTimer, destroyMse, enabled, pump, userId]);

  return { receiving };
}
