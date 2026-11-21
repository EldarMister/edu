import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { playRadioAudio } from '@/lib/audio';
import { PttPlayback } from './liveAudio';
import { createPttOpusDecoder, isPttOpusCodec, preparePttOpus, pttOpusFrames, pttOpusHeader, PTT_OPUS_PROFILES } from './opusAudio';
import { playPttCue, playPttMessage } from './sounds';
import { PTT_EVENTS, type PttPresencePayload, type PttAudioPayload, type PttBusyPayload, type PttChannel, type PttFramePayload, type PttFreePayload, type PttOpusCodec } from './types';

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

import { createPttStreamReceiver, pttAudioHistory } from './sequencedAudio';
import { onRadioInput, radioInputActive } from './radioAudioGate';

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
    if (radioInputActive()) queueRef.current.length = 0;
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
      if (!audibleForCurrentChannel || payload.senderId === userId || radioInputActive()) return;
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
    void playback.prepareStartCue().catch(() => undefined);
    type OpusTalk = { id: string; codec: PttOpusCodec; header: Uint8Array; speaker: PttPlayingSpeaker };
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

    function playFrame(id: string, who: PttPlayingSpeaker, audio: ArrayBuffer | Float32Array, sampleRate?: number, framesInPacket?: number, buffered = false) {
      if (radioInputActive()) return;
      const startsTalk = id !== talkId;
      window.clearTimeout(endTimer);
      if (startsTalk) {
        talkId = id;
        setLiveSpeaker(who);
      }
      if (!playback.push(audio, startsTalk, sampleRate, framesInPacket, buffered) && startsTalk) {
        // Preserve the existing tap-to-unlock flow on browsers that suspend audio.
        void playPttCue('start', 'receiver');
      }
    }

    function hears(source: PttChannel, senderId: string) {
      return (source === 'general' || source === channel) && senderId !== userId;
    }

    function onBusy(payload: PttBusyPayload) {
      if (payload.sequenced || !isPttOpusCodec(payload.codec) || !payload.talkId || !payload.speaker || !hears(payload.channel, payload.speaker.id)) return;
      opusTalk = { id: payload.talkId, codec: payload.codec, header: pttOpusHeader(payload.talkId), speaker: payload.speaker };
    }

    function onPacket(packet: unknown) {
      const stream = opusTalk;
      if (!stream) return;
      const frames = pttOpusFrames(packet, stream.header, stream.codec);
      if (!frames.length) return;

      queue(async () => {
        if (decoderTalkId !== stream.id) {
          const next = await createPttOpusDecoder(stream.codec);
          if (!active) { next.free(); return; }
          closeDecoder();
          decoder = next;
          decoderTalkId = stream.id;
        }
        if (!decoder) return;
        const sampleRate = PTT_OPUS_PROFILES[stream.codec].sampleRate;
        for (const [index, frame] of frames.entries()) {
          playFrame(stream.id, stream.speaker, decoder.decodeFloat(frame), sampleRate, index === 0 ? frames.length : 0);
        }
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
      if (payload.frames !== undefined) {
        sequenced.free(payload);
        return;
      }
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

    const sequenced = createPttStreamReceiver({
      hears: (batch) => hears(batch.channel, batch.senderId),
      async openDecoder(codec) {
        const decoder = await createPttOpusDecoder(codec);
        const profile = PTT_OPUS_PROFILES[codec];
        return { ...profile, decode: (audio) => decoder.decodeFloat(audio), close: () => decoder.free() };
      },
      sync: pttAudioHistory(socket),
      play(batch, samples, rate) {
        playFrame(batch.talkId, { id: batch.senderId, name: batch.senderName, role: batch.senderRole }, samples, rate, 1, true);
      },
      end(id) {
        if (talkId !== id) return;
        playback.endCue();
        clearSpeakerAfterPlayback();
      },
    });
    const stopOnInput = onRadioInput(() => {
      playback.stop();
      talkId = undefined;
      window.clearTimeout(endTimer);
      setLiveSpeaker(null);
    });
    function onPresence(payload: PttPresencePayload) {
      if (payload.channel === channel) sequenced.joined();
    }
    function onDisconnect() {
      sequenced.disconnected();
      opusTalk = undefined;
      queue(() => {
        closeDecoder();
        clearSpeakerAfterPlayback();
      });
    }

    socket.on(PTT_EVENTS.CHANNEL_BUSY, onBusy);
    socket.on(PTT_EVENTS.AUDIO_PACKET, onPacket);
    socket.on(PTT_EVENTS.AUDIO_BATCH, sequenced.batch);
    socket.on(PTT_EVENTS.PRESENCE, onPresence);
    socket.on(PTT_EVENTS.AUDIO_FRAME, onFrame);
    socket.on(PTT_EVENTS.CHANNEL_FREE, onFree);
    socket.on('disconnect', onDisconnect);
    return () => {
      active = false;
      socket.off(PTT_EVENTS.CHANNEL_BUSY, onBusy);
      socket.off(PTT_EVENTS.AUDIO_PACKET, onPacket);
      socket.off(PTT_EVENTS.AUDIO_BATCH, sequenced.batch);
      socket.off(PTT_EVENTS.PRESENCE, onPresence);
      stopOnInput();
      sequenced.dispose();
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
