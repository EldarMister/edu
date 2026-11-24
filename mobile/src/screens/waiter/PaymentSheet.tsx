import React, { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { CashShiftEditor } from '@/components/CashShiftPanel';
import { Button, Field, Loading, PillTabs } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useCashAccess, useCashShiftState } from '@/services/api/cash-shifts';
import { usePay } from '@/services/api/waiter';
import { usePublicSettings, resolveQrSrc } from '@/services/api/settings';
import { colors, fontSize, radius, spacing } from '@/theme';
import { displayOrderNumber, hallSuffix, money } from '@/utils/format';
import { mixedTender, moneyCents, tenderLabels, type Tender } from '@/utils/payment';
import type { Order, PaymentMethod } from '@/types';

const paymentOrder: Tender[] = ['qr', 'cash', 'card'];

export function PaymentSheet({ order, onClose, onPaid }: { order: Order; onClose: () => void; onPaid: () => void }) {
  const settings = usePublicSettings();
  const pay = usePay();
  const { canManage } = useCashAccess();
  const totalInCents = moneyCents(order.finalAmount);
  const total = Number(order.finalAmount);
  const cashShift = useCashShiftState(canManage && total > 0);
  const [openingCashShift, setOpeningCashShift] = useState(false);
  const [selected, setSelected] = useState<PaymentMethod>();
  const [drafts, setDrafts] = useState({ cash: '', card: '', qr: '' });
  const submitting = useRef(false);
  const qrSrc = resolveQrSrc(settings.data?.qrImageUrl);
  const available = paymentOrder.filter((method) => settings.data?.paymentMethods.includes(method) && (method !== 'qr' || qrSrc));
  const options: { key: PaymentMethod; label: string }[] = available.map((method) => ({ key: method, label: tenderLabels[method] }));
  if (available.length >= 2 && total > 0) options.push({ key: 'mixed', label: 'Смешанная' });
  const method = options.some(({ key }) => key === selected) ? selected : options[0]?.key;
  const mixed = method === 'mixed' && totalInCents != null ? mixedTender(totalInCents, drafts, available) : null;
  const cashShiftRequired = cashShift.data?.enabled && !cashShift.data.current;

  async function submit() {
    if (submitting.current || !method || (method === 'mixed' && !mixed) || totalInCents == null) return;
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

  if (openingCashShift) return <CashShiftEditor mode="open" current={null}
    onClose={() => setOpeningCashShift(false)} />;
  return <BottomSheet visible onClose={() => { if (!submitting.current) onClose(); }} title="Оплата заказа"
    maxHeight="92%" bodyStyle={styles.body} footer={
      cashShiftRequired ? <Button title="Открыть кассовую смену" onPress={() => setOpeningCashShift(true)} />
        : <Button title={`Принять оплату · ${money(total)}`} onPress={() => void submit()} loading={pay.isPending}
          disabled={!method || (canManage && total > 0 && cashShift.isPending) || (method === 'mixed' && !mixed)} />
    }>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>Стол {order.table.number}{hallSuffix(order.table)} · {displayOrderNumber(order.orderNumber)}</Text>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>К оплате</Text>
        <Text style={styles.totalValue}>{money(total)}</Text>
      </View>
      {Number(order.discountAmount) > 0 && <Text style={styles.subtitle}>Скидка · {money(order.discountAmount)}</Text>}
      {settings.isPending ? <Loading text="Загрузка способов оплаты…" /> : null}
      {settings.error ? <Text accessibilityRole="alert" style={styles.error}>{apiError(settings.error)}</Text> : null}
      {!settings.isPending && !settings.error && !options.length ? <Text style={styles.subtitle}>Нет настроенных способов оплаты</Text> : null}
      {cashShiftRequired ? <Text style={styles.subtitle}>Откройте кассовую смену перед оплатой.</Text> : null}
      {options.length > 0 && !cashShiftRequired ? <PillTabs items={options} value={method ?? ''}
        onChange={(value) => { if (!submitting.current) setSelected(value as PaymentMethod); }} /> : null}
      {!cashShiftRequired && method === 'mixed' ? <View style={styles.content}>
        {available.map((value) => <Field key={value} label={tenderLabels[value]} value={drafts[value]} keyboardType="decimal-pad"
          placeholder="0,00" maxLength={13} editable={!pay.isPending}
          onChangeText={(input) => setDrafts((current) => ({ ...current, [value]: input }))} />)}
        {mixed?.change ? <Text>Сдача · {money(mixed.change)}</Text> : null}
        {!mixed ? <Text style={styles.subtitle}>Укажите суммы по двум или более способам. Итог оплаты должен совпадать с чеком.</Text> : null}
      </View> : null}
      {!cashShiftRequired && qrSrc && (method === 'qr' || (mixed?.qrAmount ?? 0) > 0) ? <View style={styles.qrBox}>
        <Text style={styles.subtitle}>Покажите QR-код гостю</Text>
        <Image source={{ uri: qrSrc }} accessibilityLabel="QR-код для оплаты" style={styles.qrImage} resizeMode="contain" />
      </View> : null}
      {!cashShiftRequired && method === 'card' ? <Text style={styles.subtitle}>Подтвердите оплату на банковском терминале.</Text> : null}
      {pay.error ? <Text accessibilityRole="alert" style={styles.error}>{apiError(pay.error)}</Text> : null}
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  body: { flexShrink: 1 },
  content: { gap: spacing.md },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: fontSize.md, color: colors.textSecondary },
  totalValue: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
  qrBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', gap: spacing.sm },
  qrImage: { width: 180, height: 180 },
  error: { color: colors.danger },
});
