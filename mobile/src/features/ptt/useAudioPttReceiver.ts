import React from 'react';
import { AppState, Platform } from 'react-native';
import { getSocket } from '@/services/socket';
import { useAuth } from '@/store/auth';
import {
  PTT_EVENTS, type PttAudioPayload, type PttBusyPayload, type PttChannel, type PttFramePayload, type PttFreePayload,
} from './types';
import { PttPlaybackQueue } from './audioPlayback';
import { isPttBackgroundRuntimeActive } from './backgroundFlag';
import { RadioPlayout } from './nativeAudio';
import {
  createOpusDecoder, FRAME_BYTES, getOpusProfile, opusFrames, opusHeader, packetBytes, pcmFloats, prepareOpus,
  SPEECH_RATE, type OpusMode,
} from './opusAudio';

export type PttPlayingSpeaker = { id: string; name?: string; role?: string };

export function useAudioPttReceiver(channel: PttChannel, enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  const workspace = useAuth((s) => s.workspace);
  const [legacySpeaker, setLegacySpeaker] = React.useState<PttPlayingSpeaker | null>(null);
  const [liveSpeaker, setLiveSpeaker] = React.useState<PttPlayingSpeaker | null>(null);

  React.useEffect(() => {
    if (!enabled || !userId) return;

    const socket = getSocket();
    const legacy = new PttPlaybackQueue(payload => {
      setLegacySpeaker(payload ? { id: payload.senderId, name: payload.senderName, role: payload.senderRole } : null);
    });
    const playback = new RadioPlayout();
    let stream: { id: string; codec: OpusMode; header: Uint8Array; speaker: PttPlayingSpeaker } | undefined;
    let decoder: ReturnType<typeof createOpusDecoder> | undefined;
    let decoderId: string | undefined;
    let playingId: string | undefined;
    let speakerTimer: ReturnType<typeof setTimeout> | undefined;
    const warmTimer = setTimeout(() => {
      try { prepareOpus(); } catch { /* The next talk can retry codec initialization. */ }
    }, 0);
    function hears(source: PttChannel, senderId: string) {
      return (source === 'general' || source === channel) && senderId !== userId;
    }
    function appCanPlay() {
      // Keep the same decoder/playout when Android moves between foreground
      // and its existing listening service. The app-level overlay stays mounted.
      return AppState.currentState === 'active' || (Platform.OS === 'android' && isPttBackgroundRuntimeActive());
    }
    function closeDecoder() {
      decoder?.close();
      decoder = undefined;
      decoderId = undefined;
    }
    function play(id: string, speaker: PttPlayingSpeaker, samples: Float32Array, sampleRate: number) {
      if (!appCanPlay()) return;
      const newTalk = playingId !== id;
      playback.push(samples, newTalk, sampleRate);
      if (newTalk) {
        clearTimeout(speakerTimer);
        setLiveSpeaker(speaker);
        playingId = id;
      }
    }
    function clearSpeakerAfterPlayback() {
      clearTimeout(speakerTimer);
      speakerTimer = setTimeout(() => {
        playingId = undefined;
        setLiveSpeaker(null);
        playback.stop();
      }, Math.ceil(playback.remainingMs()));
    }
    function onLegacyAudio(payload: PttAudioPayload) {
      // The Android service handles legacy whole-file messages while backgrounded.
      if (Platform.OS === 'android' && AppState.currentState !== 'active') return;
      if (hears(payload.channel, payload.senderId)) legacy.enqueue(payload);
    }
    function onBusy(payload: PttBusyPayload) {
      if (payload.codec !== 'opus' && payload.codec !== 'opus-hq') return;
      if (!payload.talkId || !payload.speaker || !hears(payload.channel, payload.speaker.id)) return;
      try {
        stream = { id: payload.talkId, codec: payload.codec, header: opusHeader(payload.talkId), speaker: payload.speaker };
      } catch {
        // An invalid talk identifier cannot be matched to a binary packet.
      }
    }
    function onPacket(packet: unknown) {
      if (!stream || !appCanPlay()) return;
      const frames = opusFrames(packet, stream.header, stream.codec);
      if (!frames.length) return;
      try {
        if (decoderId !== stream.id) {
          closeDecoder();
          decoder = createOpusDecoder(stream.codec);
          decoderId = stream.id;
        }
        if (!decoder) return;
        const profile = getOpusProfile(stream.codec);
        let samples = decoder.decode(frames[0]);
        if (frames.length > 1) {
          const packetSamples = new Float32Array(profile.frameSamples * frames.length);
          packetSamples.set(samples);
          for (let index = 1; index < frames.length; index++) {
            packetSamples.set(decoder.decode(frames[index]), index * profile.frameSamples);
          }
          samples = packetSamples;
        }
        play(stream.id, stream.speaker, samples, profile.sampleRate);
      } catch (error) {
        console.warn('[ptt] Не удалось воспроизвести звук рации:', error);
        closeDecoder();
        stream = undefined;
        clearSpeakerAfterPlayback();
      }
    }
    function onFrame(payload: PttFramePayload) {
      if (!hears(payload.channel, payload.senderId) || !appCanPlay()) return;
      const bytes = packetBytes(payload.audio);
      if (bytes?.length !== FRAME_BYTES) return;
      try {
        play(payload.talkId, { id: payload.senderId, name: payload.senderName, role: payload.senderRole }, pcmFloats(bytes), SPEECH_RATE);
      } catch (error) {
        console.warn('[ptt] Не удалось воспроизвести звук рации:', error);
      }
    }
    function onFree(payload: PttFreePayload) {
      const id = payload.talkId;
      if (!id) return;
      if (stream?.id === id) stream = undefined;
      if (decoderId === id) closeDecoder();
      if (playingId !== id) return;
      playback.endCue();
      clearSpeakerAfterPlayback();
    }
    function onDisconnect() {
      stream = undefined;
      closeDecoder();
      clearSpeakerAfterPlayback();
    }

    socket.on(PTT_EVENTS.AUDIO_MESSAGE, onLegacyAudio);
    socket.on(PTT_EVENTS.CHANNEL_BUSY, onBusy);
    socket.on(PTT_EVENTS.AUDIO_PACKET, onPacket);
    socket.on(PTT_EVENTS.AUDIO_FRAME, onFrame);
    socket.on(PTT_EVENTS.CHANNEL_FREE, onFree);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off(PTT_EVENTS.AUDIO_MESSAGE, onLegacyAudio);
      socket.off(PTT_EVENTS.CHANNEL_BUSY, onBusy);
      socket.off(PTT_EVENTS.AUDIO_PACKET, onPacket);
      socket.off(PTT_EVENTS.AUDIO_FRAME, onFrame);
      socket.off(PTT_EVENTS.CHANNEL_FREE, onFree);
      socket.off('disconnect', onDisconnect);
      clearTimeout(speakerTimer);
      clearTimeout(warmTimer);
      closeDecoder();
      legacy.clear();
      playback.stop();
      setLiveSpeaker(null);
    };
  }, [channel, enabled, userId, workspace]);

  const speaker = liveSpeaker ?? legacySpeaker;
  return { receiving: !!speaker, speaker };
}
