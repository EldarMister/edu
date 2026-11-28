import React, { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CashShiftEditor } from '@/components/CashShiftPanel';
import { Button, Field, Loading } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useCashAccess, useCashShiftState } from '@/services/api/cash-shifts';
import { usePay } from '@/services/api/waiter';
import { usePublicSettings, resolveQrSrc } from '@/services/api/settings';
import { colors, fontSize, radius, spacing } from '@/theme';
import { displayOrderNumber, hallSuffix, money } from '@/utils/format';
import { mixedTender, moneyCents, tenderLabels, type Tender } from '@/utils/payment';
import type { Order, PaymentMethod } from '@/types';
import { mobilePaymentMethods } from '../../../../frontend/src/features/waiter/mobilePaymentMethods';

const paymentOrder: Tender[] = ['qr', 'cash', 'card'];

export function PaymentScreen({ order, onClose, onPaid, onSplitItems }: {
  order: Order;
  onClose: () => void;
  onPaid: () => void;
  onSplitItems?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const settings = usePublicSettings();
  const pay = usePay();
  const { canManage } = useCashAccess();
  const totalInCents = moneyCents(order.finalAmount);
  const total = Number(order.finalAmount);
  const cashShift = useCashShiftState(canManage && total > 0);
  const [openingCashShift, setOpeningCashShift] = useState(false);
  const [qrSize, setQrSize] = useState(0);
  const [selected, setSelected] = useState<PaymentMethod>();
  const [drafts, setDrafts] = useState({ cash: '', card: '', qr: '' });
  const submitting = useRef(false);
  const qrSrc = resolveQrSrc(settings.data?.qrImageUrl);
  const enabled = settings.data?.paymentMethods ?? [];
  const available = paymentOrder.filter((method) => enabled.includes(method) && (method !== 'qr' || !!qrSrc));
  const options = mobilePaymentMethods(enabled, !!qrSrc, available.length >= 2 && total > 0);
  const method = options.some(({ value }) => value === selected) ? selected
    : options.find(({ value }) => value !== 'qr' || qrSrc)?.value ?? options[0]?.value;
  const qrMissing = method === 'qr' && !qrSrc;
  const mixed = method === 'mixed' && totalInCents != null ? mixedTender(totalInCents, drafts, available) : null;
  const cashShiftRequired = cashShift.data?.enabled && !cashShift.data.current;

  async function submit() {
    if (submitting.current || !method || qrMissing || (method === 'mixed' && !mixed) || totalInCents == null) return;
    submitting.current = true;
    try {
      await pay.mutateAsync({ orderId: order.id, method, expectedAmount: total,
        cashAmount: mixed?.cashAmount, qrAmount: mixed?.qrAmount, cardAmount: mixed?.cardAmount });
      onPaid();
    } catch {
      // The sheet shows the server error and keeps the entered payment amounts.
    } finally {
      submitting.current = false;
    }
  }

  function close() {
    if (!submitting.current) onClose();
  }

  const landscape = width > height && height <= 560;
  const footerLabel = (method === 'qr' || method === 'mixed' ? 'Оплачено' : 'Принять оплату') + ' · ' + money(total);
  const errors = <>
    {!!settings.error && <Text accessibilityRole="alert" style={styles.error}>{apiError(settings.error)}</Text>}
    {!!pay.error && <Text accessibilityRole="alert" style={styles.error}>{apiError(pay.error)}</Text>}
  </>;

  if (openingCashShift) return <CashShiftEditor mode="open" current={null}
    onClose={() => setOpeningCashShift(false)} />;

  return (
    <Modal visible presentationStyle="fullScreen" onRequestClose={close}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' && method === 'mixed' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Pressable style={styles.back} onPress={close} disabled={pay.isPending} accessibilityRole="button" accessibilityLabel="Назад">
              <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.heading} accessibilityRole="header">Оплата заказа</Text>
          </View>

          <View style={[styles.body, landscape && styles.landscape]}>
            <View style={[styles.controls, landscape && styles.fill]}>
              <Text style={styles.subtitle}>Стол {order.table.number}{hallSuffix(order.table)} · {displayOrderNumber(order.orderNumber)}</Text>
              <View style={styles.total}>
                <Text style={styles.subtitle}>К оплате</Text>
                <Text style={styles.totalValue}>{money(total)}</Text>
                {onSplitItems && <Pressable style={styles.split} accessibilityRole="button" onPress={onSplitItems} disabled={pay.isPending}>
                  <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
                  <Text style={styles.splitText}>Разделить по позициям</Text>
                </Pressable>}
              </View>
              {Number(order.discountAmount) > 0 && <Text style={styles.subtitle}>Скидка · {money(order.discountAmount)}</Text>}
              {settings.isPending && <Loading text="Загрузка способов оплаты…" />}
              {!settings.isPending && !settings.error && !options.length && <Text style={styles.subtitle}>Нет настроенных способов оплаты</Text>}
              {cashShiftRequired && <Text style={styles.subtitle}>Откройте кассовую смену перед оплатой.</Text>}
              {options.length > 0 && !cashShiftRequired && <View style={styles.methods}>
                <Text style={styles.methodLabel}>Способ оплаты</Text>
                <View style={styles.methodRow}>
                  {options.map(({ value, label }) => <Pressable key={value} accessibilityRole="button"
                    accessibilityState={{ selected: value === method }} disabled={pay.isPending}
                    style={[styles.method, value === method && styles.methodActive]}
                    onPress={() => { if (!submitting.current) setSelected(value); }}>
                    <Text style={[styles.methodText, value === method && styles.methodTextActive]}>{label}</Text>
                  </Pressable>)}
                </View>
              </View>}
            </View>

            {!cashShiftRequired && method === 'qr' && qrSrc ? <View style={styles.qr}>
              <Text style={styles.qrCaption}>Покажите QR-код клиенту для оплаты</Text>
              <View style={styles.qrSpace} onLayout={({ nativeEvent: { layout } }) => {
                setQrSize(Math.floor(Math.min(layout.width, layout.height, 440)));
              }}>
                {qrSize > 0 && <View style={[styles.qrFrame, { width: qrSize, height: qrSize }]}>
                  <Image source={{ uri: qrSrc }} accessibilityLabel="QR-код для оплаты" style={styles.qrImage} resizeMode="contain" />
                </View>}
              </View>
              <Text style={styles.qrCaption}>Ожидание оплаты</Text>
              {errors}
            </View> : <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.details}>
              {!cashShiftRequired && qrMissing && <Text style={styles.error}>QR-код не загружен. Добавьте его в настройках или выберите другой способ оплаты.</Text>}
              {!cashShiftRequired && method === 'mixed' && <>
                {available.map((value) => <Field key={value} label={tenderLabels[value]} value={drafts[value]} keyboardType="decimal-pad"
                  placeholder="0,00" maxLength={13} editable={!pay.isPending}
                  onChangeText={(input) => setDrafts((current) => ({ ...current, [value]: input }))} />)}
                {!!mixed?.change && <Text style={styles.subtitle}>Сдача · {money(mixed.change)}</Text>}
                {!mixed && <Text style={styles.subtitle}>Укажите суммы по двум или более способам. Итог оплаты должен совпадать с чеком.</Text>}
                {!!qrSrc && (mixed?.qrAmount ?? 0) > 0 && <View style={styles.mixedQr}>
                  <Text style={styles.qrCaption}>Покажите QR-код клиенту для оплаты</Text>
                  <Image source={{ uri: qrSrc }} accessibilityLabel="QR-код для оплаты" style={styles.mixedQrImage} resizeMode="contain" />
                </View>}
              </>}
              {!cashShiftRequired && method === 'card' && <Text style={styles.subtitle}>Подтвердите оплату на банковском терминале.</Text>}
              {errors}
            </ScrollView>}
          </View>

          <View style={styles.footer}>
            {cashShiftRequired ? <Button title="Открыть кассовую смену" onPress={() => setOpeningCashShift(true)} />
              : <Button title={footerLabel} onPress={() => void submit()} loading={pay.isPending}
                disabled={!method || qrMissing || (canManage && total > 0 && cashShift.isPending) || (method === 'mixed' && !mixed)} />}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white, paddingHorizontal: 14 },
  fill: { flex: 1, minWidth: 0 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  body: { flex: 1, minHeight: 0, paddingVertical: 10, gap: 10 },
  landscape: { flexDirection: 'row', gap: 18 },
  controls: { gap: 10 },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  total: { alignItems: 'center', gap: 2 },
  totalValue: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  split: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  splitText: { fontSize: fontSize.sm, color: colors.primary },
  methods: { gap: spacing.sm },
  methodLabel: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  methodRow: { flexDirection: 'row', gap: spacing.sm },
  method: { flex: 1, minWidth: 0, minHeight: 42, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  methodActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  methodText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  methodTextActive: { color: colors.primary },
  details: { gap: spacing.sm },
  qr: { flex: 1, minHeight: 0, minWidth: 0, alignItems: 'center', gap: 5 },
  qrCaption: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  qrSpace: { flex: 1, minHeight: 0, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  qrFrame: { backgroundColor: '#fff', borderRadius: 5, padding: 6 },
  qrImage: { width: '100%', height: '100%' },
  mixedQr: { alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  mixedQrImage: { width: 180, height: 180 },
  error: { color: colors.danger, fontSize: fontSize.sm },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 9 },
});
