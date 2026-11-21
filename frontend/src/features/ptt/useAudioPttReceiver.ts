import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { playRadioAudio } from '@/lib/audio';
import { PttPlayback } from './liveAudio';
import { createPttOpusDecoder, preparePttOpus, pttOpusFrames, pttOpusHeader } from './opusAudio';
import { playPttCue, playPttMessage } from './sounds';
import { PTT_EVENTS, type PttAudioPayload, type PttBusyPayload, type PttChannel, type PttFramePayload, type PttFreePayload } from './types';

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
  const [liveSpeaker, setLiveSpeaker] = useState<PttPlayingSpeaker | null>(null);
  const queueRef = useRef<PttAudioPayload[]>([]);
  const playingRef = useRef(false);

  // Каждое сообщение — цельный файл. Выравниваем громкость и воспроизводим
  // через тот же мультимедийный аудиовыход, что озвучку и уведомления.
  const playPayload = useCallback(async (payload: PttAudioPayload) => {
    const bytes = base64ToBytes(payload.chunk);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([data], { type: payload.mimeType || 'application/octet-stream' });
    await playPttMessage(() => playRadioAudio(blob));
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

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const playback = new PttPlayback();
    type OpusTalk = { id: string; header: Uint8Array; speaker: PttPlayingSpeaker };
    let active = true;
    let talkId: string | undefined;
    let opusTalk: OpusTalk | undefined;
    let decoderTalkId: string | undefined;
    let decoder: Awaited<ReturnType<typeof createPttOpusDecoder>> | undefined;
    let endTimer: number | undefined;
    let incoming = Promise.resolve();

    // Compile the bundled codec before the first speaker starts.
    void preparePttOpus().catch(() => undefined);

    function queue(play: () => void | Promise<void>) {
      incoming = incoming.then(() => { if (active) return play(); }).catch((error: unknown) => {
        console.warn('[ptt] Не удалось обработать звук рации:', error);
      });
    }

    function closeDecoder() {
      decoder?.free();
      decoder = undefined;
      decoderTalkId = undefined;
    }

    function playFrame(id: string, who: PttPlayingSpeaker, audio: ArrayBuffer | Float32Array) {
      const startsTalk = id !== talkId;
      if (startsTalk) {
        window.clearTimeout(endTimer);
        talkId = id;
        setLiveSpeaker(who);
      }
      if (!playback.push(audio, startsTalk) && startsTalk) {
        // Preserve the existing tap-to-unlock flow on browsers that suspend audio.
        void playPttCue('start', 'receiver');
      }
    }

    function hears(source: PttChannel, senderId: string) {
      return (source === 'general' || source === channel) && senderId !== userId;
    }

    function onBusy(payload: PttBusyPayload) {
      if (payload.codec !== 'opus' || !payload.talkId || !payload.speaker || !hears(payload.channel, payload.speaker.id)) return;
      opusTalk = { id: payload.talkId, header: pttOpusHeader(payload.talkId), speaker: payload.speaker };
    }

    function onPacket(packet: unknown) {
      const stream = opusTalk;
      if (!stream) return;
      const frames = pttOpusFrames(packet, stream.header);
      if (!frames.length) return;

      queue(async () => {
        if (decoderTalkId !== stream.id) {
          const next = await createPttOpusDecoder();
          if (!active) { next.free(); return; }
          closeDecoder();
          decoder = next;
          decoderTalkId = stream.id;
        }
        if (!decoder) return;
        for (const frame of frames) playFrame(stream.id, stream.speaker, decoder.decodeFloat(frame));
      });
    }

    function onFrame(payload: PttFramePayload) {
      if (!hears(payload.channel, payload.senderId)) return;
      queue(() => playFrame(payload.talkId, { id: payload.senderId, name: payload.senderName, role: payload.senderRole }, payload.audio));
    }

    function clearSpeakerAfterPlayback() {
      window.clearTimeout(endTimer);
      endTimer = window.setTimeout(() => {
        talkId = undefined;
        setLiveSpeaker(null);
      }, Math.ceil(playback.remainingMs()));
    }

    function onFree(payload: PttFreePayload) {
      const finished = payload.talkId;
      if (!finished) return;
      if (opusTalk?.id === finished) opusTalk = undefined;
      queue(() => {
        if (decoderTalkId === finished) closeDecoder();
        if (talkId !== finished) return;
        playback.endCue();
        clearSpeakerAfterPlayback();
      });
    }

    function onDisconnect() {
      opusTalk = undefined;
      queue(() => {
        closeDecoder();
        clearSpeakerAfterPlayback();
      });
    }

    socket.on(PTT_EVENTS.CHANNEL_BUSY, onBusy);
    socket.on(PTT_EVENTS.AUDIO_PACKET, onPacket);
    socket.on(PTT_EVENTS.AUDIO_FRAME, onFrame);
    socket.on(PTT_EVENTS.CHANNEL_FREE, onFree);
    socket.on('disconnect', onDisconnect);
    return () => {
      active = false;
      socket.off(PTT_EVENTS.CHANNEL_BUSY, onBusy);
      socket.off(PTT_EVENTS.AUDIO_PACKET, onPacket);
      socket.off(PTT_EVENTS.AUDIO_FRAME, onFrame);
      socket.off(PTT_EVENTS.CHANNEL_FREE, onFree);
      socket.off('disconnect', onDisconnect);
      window.clearTimeout(endTimer);
      closeDecoder();
      playback.stop();
      setLiveSpeaker(null);
    };
  }, [channel, enabled, userId]);

  return { receiving: receiving || !!liveSpeaker, speaker: liveSpeaker ?? speaker };
}
