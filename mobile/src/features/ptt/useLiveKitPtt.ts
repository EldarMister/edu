import { useCallback, useEffect, useRef, useState } from 'react';
import { createLocalAudioTrack, Room, RoomEvent, Track, type LocalAudioTrack } from 'livekit-client';
import { getSocket } from '@/services/socket';
import { randomUUID as newTalkId } from 'expo-crypto';
import type { PttChannel } from './types';
import { activateRadioAudio, attachRemoteAudio, observeRadioInterruption, radioCue } from './liveKitAudio';

type ChannelToken = { channel: PttChannel; token: string };
type ConnectionAck = { ok: boolean; reason?: string; url?: string; channels?: ChannelToken[] };
type TalkAck = { ok: boolean; reason?: string; codec?: string };
type LegacySender = {
  start(): Promise<boolean>;
  stop(): void;
  talking: boolean;
  preparing: boolean;
  deniedReason: string | null;
};
type Session = { rooms: Map<PttChannel, Room>; close(): void };
type Attempt = { id: string; room: Room; released: boolean; active: boolean; keepalive?: ReturnType<typeof setInterval> };
const TAIL_CAPTURE_MS = 130;
const TAIL_DELIVERY_MS = 270;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useLiveKitPtt(channel: PttChannel, enabled: boolean, open: boolean, legacy: LegacySender, userId?: string) {
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const microphone = useRef<LocalAudioTrack | null>(null);
  const micRequest = useRef<Promise<LocalAudioTrack | null> | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const press = useRef(0);
  const legacyPress = useRef(false);
  const panelOpen = useRef(open);
  const legacyStop = useRef(legacy.stop);
  legacyStop.current = legacy.stop;
  panelOpen.current = open;

  const prepareMicrophone = useCallback(() => {
    if (microphone.current?.mediaStreamTrack.readyState === 'live') return Promise.resolve(microphone.current);
    if (micRequest.current) return micRequest.current;
    const pending = createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
      .then(async (track) => {
        if (micRequest.current !== pending || !panelOpen.current) {
          track.stop();
          return null;
        }
        await track.mute();
        if (micRequest.current !== pending || !panelOpen.current) {
          track.stop();
          return null;
        }
        microphone.current?.stop();
        microphone.current = track;
        return track;
      }).finally(() => {
        if (micRequest.current === pending) micRequest.current = null;
      });
    micRequest.current = pending;
    return pending;
  }, []);

  const stopMicrophone = useCallback(() => {
    micRequest.current = null;
    microphone.current?.stop();
    microphone.current = null;
  }, []);

  const finish = useCallback((talk: Attempt, socket = getSocket()) => {
    if (attempt.current !== talk) return;
    attempt.current = null;
    clearInterval(talk.keepalive);
    const mic = microphone.current;
    if (mic) {
      mic.mediaStreamTrack.enabled = false;
      void mic.mute().catch(() => undefined);
    }
    if (socket.connected) socket.emit('ptt_stop_talk', { channel, talkId: talk.id });
    setPreparing(false);
    setTalking(false);
  }, [channel]);

  const interrupt = useCallback(() => {
    press.current++;
    if (attempt.current) finish(attempt.current);
    if (legacyPress.current) {
      legacyPress.current = false;
      legacyStop.current();
    }
    stopMicrophone();
  }, [finish, stopMicrophone]);

  useEffect(() => {
    if (!open) interrupt();
  }, [open, interrupt]);

  useEffect(() => {
    if (open && ready) void prepareMicrophone().catch(() => undefined);
  }, [open, ready, prepareMicrophone]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    let generation = 0;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let connecting = false;
    let lastCueId: string | undefined;
    const unobserve = observeRadioInterruption(interrupt);

    function forget() {
      generation++;
      connecting = false;
      clearTimeout(retry);
      const current = session.current;
      session.current = null;
      current?.close();
      setReady(false);
    }

    function invalidate() {
      const current = attempt.current;
      if (current) finish(current, socket);
      forget();
    }

    async function connect(retriesLeft = 3) {
      if (disposed || connecting || !socket.connected || session.current) return;
      connecting = true;
      const ticket = generation;
      const current = () => !disposed && ticket === generation && socket.connected;
      // The existing overlay joins the PTT channel on the same socket.
      let setup: Session | undefined;
      try {
        const response: ConnectionAck = await socket.timeout(2500).emitWithAck('ptt_livekit_connect', { channel });
        if (!current()) return;
        if (!response.ok || !response.url || !response.channels) {
          if (response.reason === 'not_in_channel' && retriesLeft > 0) {
            retry = setTimeout(() => void connect(retriesLeft - 1), 350);
          }
          return;
        }
        const releaseAudio = await activateRadioAudio();
        const rooms = new Map<PttChannel, Room>();
        const detach = new Map<PttChannel, () => void>();
        setup = {
          rooms,
          close() {
            for (const unbind of detach.values()) unbind();
            void Promise.allSettled(Array.from(rooms.values(), room => room.disconnect())).finally(releaseAudio);
          },
        };
        if (!current()) return;
        for (const entry of response.channels) {
          const room = new Room({ stopLocalTrackOnUnpublish: false });
          room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (current() && track.kind === Track.Kind.Audio) socket.emit('ptt_livekit_track_ready', {
              channel: entry.channel, publisher: participant.identity, trackSid: publication.trackSid,
            });
          });
          rooms.set(entry.channel, room);
          detach.set(entry.channel, attachRemoteAudio(room));
        }
        const candidate = setup;
        await Promise.all(Array.from(rooms, ([name, room]) => {
          const token = response.channels!.find((entry) => entry.channel === name)!.token;
          return room.connect(response.url!, token, { autoSubscribe: true });
        }));
        if (!current() || !rooms.has(channel)) return;
        const ack = await socket.timeout(2000).emitWithAck('ptt_livekit_ready', { channel, ready: true });
        if (!ack?.ok || !current()) return;
        session.current = candidate;
        setup = undefined;
        const changed = () => {
          if (session.current !== candidate || !socket.connected) return;
          const connected = Array.from(rooms.values()).every((room) => room.state === 'connected');
          if (!connected && attempt.current) finish(attempt.current, socket);
          setReady(connected);
          socket.emit('ptt_livekit_ready', { channel, ready: connected });
        };
        for (const room of rooms.values()) {
          room.on(RoomEvent.ConnectionStateChanged, changed);
          room.on(RoomEvent.Disconnected, () => {
            if (session.current !== candidate) return;
            invalidate();
            retry = setTimeout(() => void connect(), 1500);
          });
        }
        setReady(true);
      } catch {
        if (current() && retriesLeft > 0) retry = setTimeout(() => void connect(retriesLeft - 1), 1250);
      } finally {
        setup?.close();
        if (ticket === generation) connecting = false;
      }
    }

    function busy(payload: { codec?: string; speaker?: { id: string }; talkId?: string }) {
      if (payload.codec !== 'livekit' || !payload.talkId || payload.talkId === lastCueId
        || !payload.speaker?.id || payload.speaker.id === userId || !session.current) return;
      lastCueId = payload.talkId;
      radioCue('receiver');
    }
    function denied(payload: { talkId?: string }) {
      if (!attempt.current || payload.talkId !== attempt.current.id) return;
      setError('Передача прервалась. Повторите фразу');
      finish(attempt.current, socket);
    }
    function reconnect() { void connect(); }
    socket.on('connect', reconnect);
    socket.on('disconnect', invalidate);
    socket.on('ptt_talk_denied', denied);
    socket.on('ptt_channel_busy', busy);
    void connect();
    return () => {
      disposed = true;
      interrupt();
      if (socket.connected) socket.emit('ptt_livekit_ready', { channel, ready: false });
      forget();
      unobserve();
      socket.off('connect', reconnect);
      socket.off('disconnect', invalidate);
      socket.off('ptt_talk_denied', denied);
      socket.off('ptt_channel_busy', busy);
    };
  }, [channel, enabled, finish, interrupt, userId]);

  const start = async () => {
    if (!enabled || attempt.current || legacyPress.current) return false;
    const gesture = ++press.current;
    setError(null);
    const useLegacy = async () => {
      if (press.current !== gesture) return false;
      stopMicrophone();
      legacyPress.current = true;
      const started = await legacy.start();
      if (!started && press.current === gesture) legacyPress.current = false;
      return started;
    };
    const room = session.current?.rooms.get(channel);
    if (!room || room.state !== 'connected') return useLegacy();

    const socket = getSocket();
    const talk: Attempt = { id: newTalkId(), room, released: false, active: false };
    attempt.current = talk;
    setPreparing(true);
    try {
      const result: TalkAck = await socket.timeout(3200).emitWithAck('ptt_start_talk', {
        channel, talkId: talk.id, codec: 'livekit',
      });
      if (attempt.current !== talk) {
        if (result.ok && socket.connected) socket.emit('ptt_stop_talk', { channel, talkId: talk.id });
        return false;
      }
      if (!result.ok || result.codec !== 'livekit') {
        finish(talk, socket);
        if (result.reason === 'legacy_required' || result.reason === 'invalid_codec') {
          return useLegacy();
        }
        setError(result.reason === 'busy' ? 'Канал занят' : 'Рация переподключается. Попробуйте ещё раз');
        return false;
      }
      talk.keepalive = setInterval(() => {
        if (socket.connected) socket.emit('ptt_livekit_keepalive', { channel, talkId: talk.id });
      }, 2000);

      const track = await prepareMicrophone();
      if (attempt.current !== talk) return false;
      if (!track) throw new Error('Microphone unavailable');
      const cutoff = Date.now() + 1800;
      while (attempt.current === talk && !room.localParticipant.permissions?.canPublish && Date.now() < cutoff) {
        await delay(20);
      }
      if (attempt.current !== talk) return false;
      if (!room.localParticipant.permissions?.canPublish) throw new Error('Media publishing grant timed out');

      const publication = await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone, audioPreset: { maxBitrate: 32000 }, dtx: false, red: true, stopMicTrackOnMute: false,
      });
      if (attempt.current !== talk) return false;
      const reception = await socket.timeout(1500).emitWithAck('ptt_livekit_wait_track', {
        channel, talkId: talk.id, trackSid: publication.trackSid,
      });
      if (attempt.current !== talk) return false;
      if (!reception?.ok) throw new Error('No listening client received the audio track');
      await track.unmute();
      if (attempt.current !== talk) {
        if (attempt.current?.room !== room) void track.mute().catch(() => undefined);
        return false;
      }
      talk.active = true;
      setPreparing(false);
      setTalking(true);
      radioCue('sender');
      return true;
    } catch {
      if (attempt.current === talk) {
        setError('Не удалось открыть голосовой канал. Проверьте доступ к микрофону');
        finish(talk, socket);
      }
      return false;
    }
  };

  const stop = useCallback(() => {
    press.current++;
    if (legacyPress.current) {
      legacyPress.current = false;
      legacyStop.current();
    }
    const talk = attempt.current;
    if (!talk || talk.released) return;
    talk.released = true;
    if (!talk.active) {
      finish(talk);
      return;
    }
    void (async () => {
      // Keep the microphone alive briefly on a normal release, then let
      // WebRTC deliver and play the last packets before revoking publishing.
      await delay(TAIL_CAPTURE_MS);
      if (attempt.current !== talk) return;
      const track = microphone.current;
      if (track) {
        track.mediaStreamTrack.enabled = false;
        void track.mute().catch(() => undefined);
      }
      setTalking(false);
      await delay(TAIL_DELIVERY_MS);
      if (attempt.current === talk) finish(talk);
    })();
  }, [finish]);

  return {
    start, stop, talking: talking || legacy.talking, preparing: preparing || legacy.preparing,
    deniedReason: error ?? legacy.deniedReason,
  };
}
