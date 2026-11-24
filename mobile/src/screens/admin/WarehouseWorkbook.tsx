import React, { useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Button } from '@/components/ui';
import { api, apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeWorkbook(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  const chunks: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    chunk += alphabet[value >>> 18] + alphabet[(value >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[value & 63] : '=');
    if (chunk.length >= 8192) { chunks.push(chunk); chunk = ''; }
  }
  return chunks.join('') + chunk;
}

export function WarehouseWorkbook({ url, filename, disabled }: { url: string; filename: string; disabled?: boolean }) {
  const push = useNotifications((state) => state.push);
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(false);
  async function download() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const directory = FileSystem.cacheDirectory;
      if (!directory || !(await Sharing.isAvailableAsync())) throw new Error('Экспорт файлов недоступен на этом устройстве');
      const { data } = await api.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
      const path = directory + filename;
      await FileSystem.writeAsStringAsync(path, encodeWorkbook(data), { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(path, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: 'Экспорт отчёта',
      });
    } catch (error) {
      push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }
  return <Button icon="export" title="Экспорт" variant="secondary" size="md" disabled={disabled} loading={loading} onPress={() => void download()} />;
}
