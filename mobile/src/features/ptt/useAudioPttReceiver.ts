import React from 'react';
import { AppState, Platform } from 'react-native';
import { getSocket } from '@/services/socket';
import { useAuth } from '@/store/auth';
import { PTT_EVENTS, type PttAudioPayload, type PttChannel } from './types';
import { PttPlaybackQueue } from './audioPlayback';

export type PttPlayingSpeaker = { id: string; name?: string; role?: string };

export function useAudioPttReceiver(channel: PttChannel, enabled: boolean) {
  const userId = useAuth((s) => s.user?.id);
  const [receiving, setReceiving] = React.useState(false);
  const [speaker, setSpeaker] = React.useState<PttPlayingSpeaker | null>(null);
  const playbackRef = React.useRef<PttPlaybackQueue | null>(null);
  if (!playbackRef.current) playbackRef.current = new PttPlaybackQueue(payload => {
    setReceiving(!!payload);
    setSpeaker(payload ? { id: payload.senderId, name: payload.senderName, role: payload.senderRole } : null);
  });

  React.useEffect(() => {
    if (!enabled) {
      playbackRef.current?.clear();
      return undefined;
    }

    const sock = getSocket();
    const onAudio = (payload: PttAudioPayload) => {
      if (Platform.OS === 'android' && AppState.currentState !== 'active') return;
      if (payload.channel !== channel || payload.senderId === userId) return;
      playbackRef.current?.enqueue(payload);
    };
    sock.on(PTT_EVENTS.AUDIO_MESSAGE, onAudio);
    return () => {
      sock.off(PTT_EVENTS.AUDIO_MESSAGE, onAudio);
      playbackRef.current?.clear();
    };
  }, [channel, enabled, userId]);

  return { receiving, speaker };
}
