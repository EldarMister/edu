import * as FileSystem from 'expo-file-system';

/**
 * Воспроизведение TTS на Android надёжнее из файла, чем из `data:`-URI
 * (expo-av часто не проигрывает большие data-URI). Пишем WAV во временный
 * файл кэша и отдаём его URI плееру, после проигрывания файл удаляем.
 */
export async function wavBufferToTempFile(buffer: ArrayBuffer): Promise<string> {
  const base64 = arrayBufferToBase64(buffer);
  const path = `${FileSystem.cacheDirectory}tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  return path;
}

export async function deleteTempFile(path: string): Promise<void> {
  await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
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
