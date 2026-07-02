import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { WEB_URL } from '@/config/env';
import type { AdminTableItem } from '@/services/api/admin';

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

  const share = () => {
    void Share.share({ message: menuUrl });
  };

  return (
    <BottomSheet visible onClose={onClose} title={`QR-код · Стол ${table.number}`}>
      <View style={styles.wrap}>
        <View style={styles.qrBox}>
          <QRCode value={menuUrl} size={220} />
        </View>
        <Text style={styles.caption}>
          {hallName} · Стол {table.number}
        </Text>
        <FastPressable onPress={share}>
          <Text style={styles.url} numberOfLines={2}>
            {menuUrl}
          </Text>
        </FastPressable>

        <Button title="Поделиться ссылкой" size="md" style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} onPress={share} />

        <Text style={styles.hint}>
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
