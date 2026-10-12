import { Audio } from 'expo-av';
import axios from 'axios';
import { API_BASE } from '@/config/env';
import { deleteTempFile, wavBufferToTempFile } from '@/lib/ttsFile';

export class QueueVoice {
  private queue: { orderId: string; at: number }[] = [];
  private pumping = false;
  private enabled = false;
  private sound: Audio.Sound | null = null;
  constructor(private reference: { code?: string; cafe?: string }) {}
  enable() { this.enabled = true; }
  disable() { this.enabled = false; this.queue = []; void this.sound?.stopAsync().catch(() => undefined); }
  enqueue(orderId: string) {
    if (!this.enabled) return;
    this.queue.push({ orderId, at: Date.now() });
    void this.pump();
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.enabled && this.queue.length) {
        const item = this.queue.shift()!;
        if (Date.now() - item.at > 30_000) continue;
        let file: string | null = null;
        let sound: Audio.Sound | null = null;
        try {
          const response = await axios.get<ArrayBuffer>(`${API_BASE}/queue/announce`, { params: { ...this.reference, order: item.orderId }, responseType: 'arraybuffer', timeout: 15000 });
          if (!this.enabled || Date.now() - item.at > 30_000) continue;
          file = await wavBufferToTempFile(response.data);
          await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false, shouldDuckAndroid: true });
          sound = new Audio.Sound(); this.sound = sound;
          await sound.loadAsync({ uri: file });
          const currentSound = sound;
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(resolve, 30_000);
            currentSound.setOnPlaybackStatusUpdate(status => {
              if (!status.isLoaded || status.didJustFinish || !this.enabled) { clearTimeout(timeout); resolve(); }
            });
            void currentSound.playAsync().catch(error => { clearTimeout(timeout); reject(error); });
          });
        } catch { /* Next announcement can still be played after a network/audio failure. */ }
        finally { await sound?.unloadAsync().catch(() => undefined); if (file) await deleteTempFile(file); this.sound = null; }
      }
    } finally { this.pumping = false; }
  }
}
