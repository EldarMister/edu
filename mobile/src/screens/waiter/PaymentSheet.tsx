import React, { useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { colors, fontSize, radius, spacing } from '@/theme';
import { usePay } from '@/services/api/waiter';
import { usePublicSettings, resolveQrSrc } from '@/services/api/settings';
import { apiError } from '@/lib/api';
import { beep } from '@/lib/sound';
import { useNotifications } from '@/store/notifications';
import { displayOrderNumber, hallSuffix, money } from '@/utils/format';
import type { Order, PaymentMethod } from '@/types';

type Tab = 'qr' | 'cash' | 'mixed';

export function PaymentSheet({
  order,
  visible,
  onClose,
  onPaid,
}: {
  order: Order | null;
  visible: boolean;
  onClose: () => void;
  onPaid: () => void;
}) {
  const settings = usePublicSettings();
  const pay = usePay();
  const push = useNotifications((s) => s.push);
  const [tab, setTab] = useState<Tab>('qr');
  const [cashInput, setCashInput] = useState('');
  const [qrInput, setQrInput] = useState('');

  const enabled = settings.data?.paymentMethods ?? (['qr', 'cash'] as PaymentMethod[]);
  const mixedAvailable = enabled.includes('qr') && enabled.includes('cash');
  const tabs = useMemo(() => {
    const list: { key: Tab; label: string }[] = [];
    if (enabled.includes('qr')) list.push({ key: 'qr', label: 'QR-код' });
    if (enabled.includes('cash')) list.push({ key: 'cash', label: 'Наличные' });
    if (mixedAvailable) list.push({ key: 'mixed', label: 'Смешанная' });
    return list;
  }, [enabled, mixedAvailable]);

  if (!order) return null;
  const total = Number(order.finalAmount);
  const qrSrc = resolveQrSrc(settings.data?.qrImageUrl);
  const onError = (e: unknown) => Alert.alert('Ошибка', apiError(e));

  const submit = () => {
    const onSuccess = () => {
      void beep('payment');
      push({ message: 'Оплата принята', type: 'success', at: new Date().toISOString() });
      onPaid();
    };

    if (tab === 'mixed') {
      const cash = Number(cashInput) || 0;
      const qr = Number(qrInput) || 0;
      if (Math.round(cash + qr) !== Math.round(total)) {
        Alert.alert('Проверьте суммы', `Сумма наличных и QR должна быть равна ${money(total)}`);
        return;
      }
      pay.mutate(
        { orderId: order.id, method: 'mixed', cashAmount: cash, qrAmount: qr },
        { onSuccess, onError },
      );
    } else {
      pay.mutate({ orderId: order.id, method: tab }, { onSuccess, onError });
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Оплата заказа">
      <Text style={styles.subtitle}>
        Стол {order.table.number}
        {hallSuffix(order.table)} · {displayOrderNumber(order.orderNumber)}
      </Text>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>К оплате</Text>
        <Text style={styles.totalValue}>{money(total)}</Text>
      </View>

      <Text style={styles.sectionLabel}>Способ оплаты</Text>
      <View style={styles.tabs}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.content}>
        {tab === 'qr' ? (
          <View style={styles.qrBox}>
            <Text style={styles.qrHint}>Покажите QR-код клиенту для оплаты</Text>
            {qrSrc ? (
              <Image source={{ uri: qrSrc }} style={styles.qrImage} resizeMode="contain" />
            ) : (
              <Text style={styles.qrMissing}>QR-код не настроен</Text>
            )}
          </View>
        ) : tab === 'cash' ? (
          <View style={styles.qrBox}>
            <Text style={styles.qrHint}>Примите оплату наличными — {money(total)}</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <View style={styles.mixedRow}>
              <Text style={styles.mixedLabel}>Наличные</Text>
              <TextInput
                value={cashInput}
                onChangeText={setCashInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textLight}
                style={styles.mixedInput}
              />
            </View>
            <View style={styles.mixedRow}>
              <Text style={styles.mixedLabel}>QR</Text>
              <TextInput
                value={qrInput}
                onChangeText={setQrInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textLight}
                style={styles.mixedInput}
              />
            </View>
          </View>
        )}
      </View>

      <View style={{ paddingTop: spacing.md, paddingBottom: spacing.sm }}>
        <Button
          title={`Оплачено · ${money(total)}`}
          onPress={submit}
          loading={pay.isPending}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  totalLabel: { fontSize: fontSize.md, color: colors.textSecondary },
  totalValue: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
  sectionLabel: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  tabText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.primary },
  content: { marginTop: spacing.md },
  qrBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 160,
    justifyContent: 'center',
  },
  qrHint: { fontSize: fontSize.base, color: colors.textSecondary, textAlign: 'center' },
  qrImage: { width: 200, height: 200 },
  qrMissing: { fontSize: fontSize.sm, color: colors.textLight },
  mixedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  mixedLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  mixedInput: {
    width: 140,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    textAlign: 'right',
  },
});
