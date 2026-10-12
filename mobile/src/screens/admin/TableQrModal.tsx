import React from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import QRCode from 'react-native-qrcode-svg';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { WEB_URL } from '@/config/env';
import type { AdminTableItem } from '@/services/api/admin';
import type Svg from 'react-native-svg';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';

/** QR-код меню стола (порт PWA TableQrModal): просмотр + «Поделиться» ссылкой. */
export function TableQrModal({
  table,
  hallName,
  onClose,
}: {
  table: AdminTableItem;
  hallName: string;
  onClose: () => void;
}) {
  const menuUrl = `${WEB_URL}/menu/${table.qrToken ?? ''}`;
  const qrRef = React.useRef<Svg | null>(null);
  const [busy, setBusy] = React.useState(false);
  const push = useNotifications((s) => s.push);
  const reportError = (error: unknown) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
  async function qrAction(action: 'save' | 'print') {
    if (!qrRef.current || !FileSystem.cacheDirectory) return;
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve) => qrRef.current!.toDataURL(resolve, { width: 640, height: 640 }));
      if (action === 'save') {
        if (!(await Sharing.isAvailableAsync())) throw new Error('Сохранение файлов недоступно');
        const uri = `${FileSystem.cacheDirectory}qr-stol-${table.number}.png`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Сохранить QR-код стола' });
      } else {
        const safeHall = hallName.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
        await Print.printAsync({ html: `<!doctype html><html><head><meta charset="utf-8"><style>body{text-align:center;font-family:sans-serif;padding:28px 20px;color:#0f172a}h1{font-size:26px}img{width:300px;height:300px}p{color:#64748b}</style></head><body><h1>Стол ${table.number}</h1><p>${safeHall}</p><img src="data:image/png;base64,${base64}"><h3>Отсканируйте — меню стола</h3><p>Закажите со своего телефона</p></body></html>` });
      }
    } catch (error) { reportError(error); }
    finally { setBusy(false); }
  }

  const share = () => {
    void Share.share({ message: menuUrl }).catch(reportError);
  };

  return (
    <BottomSheet visible onClose={onClose} title={`QR-код · Стол ${table.number}`}>
      <View style={styles.wrap}>
        <View style={styles.qrBox}>
          <QRCode value={menuUrl} size={220} quietZone={16} ecl="M" getRef={(ref: Svg) => { qrRef.current = ref; }} />
        </View>
        <Text style={styles.caption} translate>
          {hallName} · Стол {table.number}
        </Text>
        <FastPressable onPress={share}>
          <Text style={styles.url} numberOfLines={2}>
            {menuUrl}
          </Text>
        </FastPressable>

        <Button title="Поделиться ссылкой" size="md" style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} onPress={share} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignSelf: 'stretch' }}><Button title="Сохранить QR" variant="secondary" size="md" loading={busy} disabled={busy} onPress={() => void qrAction('save')} style={{ flex: 1 }} /><Button title="Печать" size="md" disabled={busy} onPress={() => void qrAction('print')} style={{ flex: 1 }} /></View>

        <Text style={styles.hint} translate>
          Гость отсканирует код и откроет меню этого стола со своего телефона.
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.sm },
  qrBox: {
    width: 256,
    height: 256,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    padding: 12,
  },
  caption: { marginTop: spacing.md, fontSize: fontSize.xs, color: colors.textMuted },
  url: { marginTop: spacing.sm, maxWidth: 300, textAlign: 'center', fontSize: fontSize.xs, color: colors.primary },
  hint: { marginTop: spacing.md, textAlign: 'center', fontSize: fontSize.xs, color: colors.textMuted },
});
