import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getSocket } from '@/services/socket';
import { useAuth } from '@/store/auth';
import { wavPlayback } from './androidWavRadio';
import { PttPlaybackQueue } from './audioPlayback';
import { isPttBackgroundRuntimeActive } from './backgroundFlag';
import { onRadioInput, radioInputActive } from './radioAudioGate';
import { PTT_EVENTS, type PttAudioPayload, type PttChannel } from './types';
import type { PttPlayingSpeaker } from './useAudioPttReceiver';

let nextSession = 0;

export function useAndroidWavReceiver(channel: PttChannel, enabled: boolean) {
  const userId = useAuth((state) => state.user?.id);
  const workspace = useAuth((state) => state.workspace);
  const [speaker, setSpeaker] = useState<PttPlayingSpeaker | null>(null);

  useEffect(() => {
    if (!enabled || !userId || !wavPlayback) return;
    const output = wavPlayback;
    const socket = getSocket();
    const queue: PttAudioPayload[] = [];
    const identity = (audio: PttAudioPayload) => ({ id: audio.senderId, name: audio.senderName, role: audio.senderRole });
    let finishFallback: (() => void) | undefined;
    const fallback = new PttPlaybackQueue((audio) => {
      setSpeaker(audio ? identity(audio) : null);
      if (!audio) {
        finishFallback?.();
        finishFallback = undefined;
      }
    });
    let session = String(++nextSession);
    let nativeOpen = false;
    let pumping = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    function stopTrack() {
      if (!nativeOpen) return;
      nativeOpen = false;
      try { output.stop(session); } catch { /* The native audio track may already be closed. */ }
    }
    function reset() {
      clearTimeout(drainTimer);
      clearTimeout(watchdog);
      stopTrack();
      session = String(++nextSession);
      queue.length = 0;
      pumping = false;
      fallback.clear();
    }
    function remaining() {
      if (!nativeOpen) return 0;
      try { return output.remaining(session); } catch { stopTrack(); return 0; }
    }
    function observeDrain() {
      const ms = remaining();
      if (ms > 0) drainTimer = setTimeout(observeDrain, Math.max(12, Math.min(ms, 60)));
      else {
        setSpeaker(null);
        // Keep the native track open across brief gaps between speech packets.
        if (nativeOpen) drainTimer = setTimeout(stopTrack, 450);
      }
    }
    async function pump(id: string) {
      pumping = true;
      try {
        while (id === session && queue.length) {
          const next = queue.shift()!;
          if (next.mimeType.toLowerCase().includes('wav')) {
            try {
              if (!nativeOpen) { output.begin(id); nativeOpen = true; }
              watchdog = setTimeout(reset, 1600 + Math.ceil(next.chunk.length * 0.75 / 16));
              const queued = await output.enqueue(id, next.chunk);
              if (id !== session) return;
              clearTimeout(watchdog);
              if (queued) continue;
            } catch {
              if (id !== session) return;
              clearTimeout(watchdog);
            }
          }
          while (id === session && remaining() > 0) await new Promise<void>((resolve) => setTimeout(resolve, 25));
          if (id !== session) return;
          stopTrack();
          watchdog = setTimeout(reset, 6500);
          await new Promise<void>((resolve) => {
            finishFallback = resolve;
            fallback.enqueue(next);
          });
          if (id !== session) return;
          clearTimeout(watchdog);
        }
      } finally {
        if (id === session) { pumping = false; if (nativeOpen) observeDrain(); }
      }
    }
    function receive(audio: PttAudioPayload) {
      if (radioInputActive() || audio.senderId === userId || (audio.channel !== channel && audio.channel !== 'general')) return;
      if (AppState.currentState !== 'active' && !isPttBackgroundRuntimeActive()) return;
      clearTimeout(drainTimer);
      if (queue.length === 32) queue.shift();
      queue.push(audio);
      setSpeaker(identity(audio));
      if (!pumping) void pump(session);
    }
    const stopForMicrophone = onRadioInput(reset);
    socket.on(PTT_EVENTS.NATIVE_STREAM, receive);
    socket.on('disconnect', reset);
    return () => {
      socket.off(PTT_EVENTS.NATIVE_STREAM, receive);
      socket.off('disconnect', reset);
      stopForMicrophone();
      reset();
    };
  }, [channel, enabled, userId, workspace]);

  return { speaker };
}
