import { Audio } from 'expo-av';
import { api } from '@/lib/api';
import { configureAudioPlayback } from '@/lib/sound';

class WaiterVoice {
  private queue: string[] = [];
  private pumping = false;

  enqueue(text: string | null | undefined) {
    const value = (text ?? '').trim();
    if (!value) return;
    this.queue.push(value);
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const text = this.queue.shift();
        if (!text) continue;
        try {
          await this.playText(text);
        } catch {
          // Озвучка не должна ломать realtime-сценарий официанта.
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async playText(text: string) {
    const res = await api.post<ArrayBuffer>(
      '/tts/synthesize',
      { text },
      { responseType: 'arraybuffer', timeout: 45_000 },
    );
    const uri = `data:audio/wav;base64,${arrayBufferToBase64(res.data)}`;
    await this.playUri(uri);
  }

  private async playUri(uri: string) {
    await configureAudioPlayback();
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false, volume: 1, rate: 1 });
    await new Promise<void>((resolve, reject) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          if ('error' in status && status.error) reject(new Error(status.error));
          return;
        }
        if (status.didJustFinish) resolve();
      });
      sound.playAsync().catch(reject);
    }).finally(() => {
      void sound.unloadAsync();
    });
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    output += alphabet[bytes[i] >> 2];
    output += alphabet[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    output += alphabet[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    output += alphabet[bytes[i + 2] & 63];
  }
  if (i < bytes.length) {
    output += alphabet[bytes[i] >> 2];
    if (i + 1 < bytes.length) {
      output += alphabet[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
      output += alphabet[(bytes[i + 1] & 15) << 2];
      output += '=';
    } else {
      output += alphabet[(bytes[i] & 3) << 4];
      output += '==';
    }
  }
  return output;
}

export const waiterVoice = new WaiterVoice();
