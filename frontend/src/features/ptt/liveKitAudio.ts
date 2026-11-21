import type { RemoteTrack, Room } from 'livekit-client';
import { playPttCue } from './sounds';

export async function activateRadioAudio() {
  return () => {};
}

export function attachRemoteAudio(room: Room, { RoomEvent, Track }: typeof import('livekit-client')) {
  const elements = new Map<RemoteTrack, HTMLMediaElement>();
  const detach = (track: RemoteTrack) => {
    const element = elements.get(track);
    if (!element) return;
    track.detach(element);
    element.remove();
    elements.delete(track);
  };
  const onTrack = (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio || elements.has(track)) return;
    const element = document.createElement('audio');
    element.hidden = true;
    document.body.append(element);
    elements.set(track, element);
    track.attach(element);
  };
  const unlock = () => { void room.startAudio().catch(() => undefined); };
  room.on(RoomEvent.TrackSubscribed, onTrack);
  room.on(RoomEvent.TrackUnsubscribed, detach);
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  return () => {
    room.off(RoomEvent.TrackSubscribed, onTrack);
    room.off(RoomEvent.TrackUnsubscribed, detach);
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    elements.forEach((_, track) => detach(track));
  };
}

export function observeRadioInterruption(interrupt: () => void) {
  const visibility = () => { if (document.hidden) interrupt(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', interrupt);
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', interrupt);
  };
}

export function radioCue(side: 'sender' | 'receiver') {
  void playPttCue('start', side);
}
