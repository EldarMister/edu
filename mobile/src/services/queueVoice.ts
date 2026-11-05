import { Audio } from 'expo-av';
import axios from 'axios';
import { API_BASE } from '@/config/env';
import { configureAudioPlayback } from '@/lib/sound';
import { deleteTempFile, wavBufferToTempFile } from '@/lib/ttsFile';

export class QueueVoice {
  private queue: { orderId: string; at: number }[] = [];
  private pumpingEpoch: number | null = null;
  private epoch = 0;
  private enabled = false;
  private requests = new Set<AbortController>();
  private current: { sound: Audio.Sound; finish: () => void } | null = null;
  constructor(private reference: { code?: string; cafe?: string }) {}
  enable() { this.enabled = true; }
  disable() {
    this.enabled = false; this.epoch++; this.queue = []; this.pumpingEpoch = null;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    const current = this.current; this.current = null;
    if (current) {
      current.sound.setOnPlaybackStatusUpdate(null);
      current.finish();
      void current.sound.unloadAsync().catch(() => undefined);
    }
  }
  enqueue(orderId: string) {
    if (!this.enabled) return;
    this.queue.push({ orderId, at: Date.now() });
    void this.pump();
  }
  private async pump() {
    if (this.pumpingEpoch !== null) return;
    const epoch = this.epoch;
    this.pumpingEpoch = epoch;
    const active = () => this.enabled && epoch === this.epoch;
    try {
      while (active() && this.queue.length) {
        const item = this.queue.shift()!;
        if (Date.now() - item.at > 30_000) continue;
        let file: string | null = null;
        const request = new AbortController();
        this.requests.add(request);
        try {
          const response = await axios.get<ArrayBuffer>(`${API_BASE}/queue/announce`, {
            params: { ...this.reference, order: item.orderId }, responseType: 'arraybuffer', timeout: 15000, signal: request.signal,
          });
          this.requests.delete(request);
          if (!active() || Date.now() - item.at > 30_000) continue;
          file = await wavBufferToTempFile(response.data);
          if (!active()) continue;
          await configureAudioPlayback();
          if (!active()) continue;
          const { sound } = await Audio.Sound.createAsync({ uri: file }, { shouldPlay: false, volume: 1 });
          if (!active() || Date.now() - item.at > 30_000) { await sound.unloadAsync().catch(() => undefined); continue; }
          const current = { sound, finish: () => {} };
          this.current = current;
          try {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(resolve, 30_000);
              current.finish = () => { clearTimeout(timeout); resolve(); };
              sound.setOnPlaybackStatusUpdate(status => {
                if ((!status.isLoaded && 'error' in status) || (status.isLoaded && status.didJustFinish)) current.finish();
              });
              void sound.playAsync().catch(error => { clearTimeout(timeout); reject(error); });
            });
          } finally {
            if (this.current === current) {
              this.current = null;
              sound.setOnPlaybackStatusUpdate(null);
              await sound.unloadAsync().catch(() => undefined);
            }
          }
        } catch { /* Next announcement can still be played after a network/audio failure. */ }
        finally { this.requests.delete(request); if (file) await deleteTempFile(file); }
      }
    } finally { if (this.pumpingEpoch === epoch) this.pumpingEpoch = null; }
  }
}
