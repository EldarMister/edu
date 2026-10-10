import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { configureAudioPlayback } from '@/lib/sound';
import type { PttAudioPayload } from './types';

/** Playback belongs to one receiver lifetime, including asynchronous file/sound creation. */
export class PttPlaybackQueue {
  private queue: PttAudioPayload[] = [];
  private epoch = 0;
  private pumping = false;
  private current: { sound: Audio.Sound; finish: () => void } | null = null;

  constructor(private onSpeaker?: (payload: PttAudioPayload | null) => void) {}

  enqueue(payload: PttAudioPayload) {
    this.queue.push(payload);
    void this.pump();
  }

  clear() {
    this.epoch += 1;
    this.queue = [];
    this.pumping = false;
    const current = this.current;
    this.current = null;
    if (current) {
      current.sound.setOnPlaybackStatusUpdate(null);
      current.finish();
      void current.sound.unloadAsync().catch(() => undefined);
    }
    this.onSpeaker?.(null);
  }

  private async pump() {
    if (this.pumping || !this.queue.length) return;
    const epoch = this.epoch;
    this.pumping = true;
    try {
      while (epoch === this.epoch && this.queue.length) {
        const next = this.queue.shift()!;
        this.onSpeaker?.(next);
        const extension = next.mimeType.includes('webm') ? 'webm' : next.mimeType.includes('mpeg') ? 'mp3' : 'm4a';
        const path = `${FileSystem.cacheDirectory}ptt-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        try {
          await FileSystem.writeAsStringAsync(path, next.chunk, { encoding: FileSystem.EncodingType.Base64 });
          if (epoch !== this.epoch) continue;
          await this.playFile(path, epoch);
        } catch { /* A failed radio message must not interrupt the next message. */ }
        finally { await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined); }
      }
    } finally {
      if (epoch === this.epoch) {
        this.pumping = false;
        this.onSpeaker?.(null);
      }
    }
  }

  private async playFile(uri: string, epoch: number) {
    await configureAudioPlayback();
    if (epoch !== this.epoch) return;
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false, volume: 1, progressUpdateIntervalMillis: 100 },
    );
    if (epoch !== this.epoch) {
      await sound.unloadAsync().catch(() => undefined);
      return;
    }
    const current = { sound, finish: () => {} };
    this.current = current;
    try {
      await new Promise<void>((resolve, reject) => {
        current.finish = resolve;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) {
            if ('error' in status && status.error) reject(new Error(status.error));
            return;
          }
          if (status.didJustFinish) resolve();
        });
        sound.playAsync().catch(reject);
      });
    } finally {
      if (this.current === current) {
        this.current = null;
        sound.setOnPlaybackStatusUpdate(null);
        await sound.unloadAsync().catch(() => undefined);
      }
    }
  }
}
