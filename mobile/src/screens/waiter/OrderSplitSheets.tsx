import React, { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button, Field, PillTabs } from '@/components/ui';
import { CashShiftEditor } from '@/components/CashShiftPanel';
import { apiError } from '@/lib/api';
import { useCashAccess, useCashShiftState } from '@/services/api/cash-shifts';
import { resolveQrSrc, usePublicSettings } from '@/services/api/settings';
import { usePay, useSplitOrder } from '@/services/api/waiter';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { Order, PaymentMethod } from '@/types';
import { makeIdempotencyKey, money } from '@/utils/format';
import { mixedTender, moneyCents, tenderLabels, type Tender } from '@/utils/payment';
import {
  activeSplitItems, adjustSplitAmount, indivisibleSplitItem, maxSplitShares, splitAmounts, splitCents, splitItemSelection,
  splitPaymentMethod, validSplitAmounts, type AmountSplitMode,
} from '../../../../frontend/src/features/waiter/splitBillModel';

export function SplitItemsSheet({ order, onClose, onSplit }: {
  order: Order;
  onClose: () => void;
  onSplit: (order: Order) => void;
}) {
  const split = useSplitOrder();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const request = useRef<{ payload: string; key: string }>();
  const busy = useRef(false);
  const items = activeSplitItems(order.items);
  const lines = splitItemSelection(items, draft);

  function setQuantity(id: string, quantity?: string) {
    split.reset();
    setDraft((current) => {
      const next = { ...current };
      if (quantity === undefined) delete next[id];
      else next[id] = quantity;
      return next;
    });
  }

  async function submit() {
    if (busy.current || !lines || !order.updatedAt) return;
    const payload = JSON.stringify(lines);
    if (request.current?.payload !== payload) request.current = { payload, key: makeIdempotencyKey() };
    busy.current = true;
    try {
      const result = await split.mutateAsync({
        orderId: order.id, expectedUpdatedAt: order.updatedAt, items: lines, idempotencyKey: request.current.key,
      });
      onSplit(result.newOrder);
    } catch {
      // Keep the selection and idempotency key when a request must be retried.
    } finally {
      busy.current = false;
    }
  }

  return (
    <BottomSheet visible title="Разделить по позициям" onClose={() => { if (!busy.current) onClose(); }}
      bodyStyle={styles.body} footer={<Button title="Создать отдельный чек" onPress={() => void submit()}
        disabled={!lines} loading={split.isPending} />}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {items.map((item) => {
          const checked = draft[item.id] !== undefined;
          const name = [item.dishNameSnapshot, item.dishVariantNameSnapshot].filter(Boolean).join(' · ');
          return <View style={styles.card} key={item.id}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }}
              style={styles.row} disabled={split.isPending}
              onPress={() => setQuantity(item.id, checked ? undefined : String(item.quantity))}>
              <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
              <View style={styles.grow}>
                <Text style={styles.label}>{name}</Text>
                <Text style={styles.muted}>×{item.quantity} · {money(item.finalPrice)}</Text>
              </View>
            </Pressable>
            {checked && !indivisibleSplitItem(item) && <Field label="Количество" value={draft[item.id]} keyboardType="number-pad"
              editable={!split.isPending} onChangeText={(value) => setQuantity(item.id, value)} />}
          </View>;
        })}
        {items.every((item) => Number(draft[item.id]) === item.quantity) && (
          <Text style={styles.muted}>Оставьте хотя бы одну позицию в исходном чеке.</Text>
        )}
        {!!split.error && <Text accessibilityRole="alert" style={styles.error}>{apiError(split.error)}</Text>}
      </ScrollView>
    </BottomSheet>
  );
}

type PaymentPart = { method: Tender; amount: number };
type Share = { method?: PaymentMethod; tenders: Record<Tender, string>; paid?: PaymentPart[] };
const emptyTenders = { cash: '', card: '', qr: '' };
const tenderOrder: Tender[] = ['qr', 'cash', 'card'];

export function SplitAmountsSheet({ order, mode, onClose, onPaid }: {
  order: Order;
  mode: AmountSplitMode;
  onClose: () => void;
  onPaid: () => void;
}) {
  const settings = usePublicSettings();
  const pay = usePay();
  const { canManage } = useCashAccess();
  const cashShift = useCashShiftState(canManage);
  const total = Number(order.finalAmount);
  const qrSrc = resolveQrSrc(settings.data?.qrImageUrl);
  const available = tenderOrder.filter((method) => settings.data?.paymentMethods.includes(method) && (method !== 'qr' || qrSrc));
  const options: { key: PaymentMethod; label: string }[] = available.map((key) => ({ key, label: tenderLabels[key] }));
  if (available.length > 1) options.push({ key: 'mixed', label: 'Смешанная' });
  const [inputs, setInputs] = useState(() => splitAmounts(total, 2));
  const [shares, setShares] = useState<Share[]>(() => Array.from({ length: 2 }, () => ({ tenders: emptyTenders })));
  const [openingShift, setOpeningShift] = useState(false);
  const busy = useRef(false);
  const amounts = inputs.map((value) => (moneyCents(value) ?? 0) / 100);
  const assignedValid = validSplitAmounts(total, amounts);
  const anyPaid = shares.some(({ paid }) => !!paid);
  const invalidPaidMethod = shares.some(({ paid }) => paid?.some(({ method }) => !available.includes(method)));
  const paidCents = shares.reduce((sum, share, i) => sum + (share.paid ? splitCents(amounts[i]) : 0), 0);
  const shiftRequired = cashShift.data?.enabled && !cashShift.data.current;

  function changeCount(count: number) {
    if (anyPaid || count < 2 || count > maxSplitShares(total)) return;
    setShares(Array.from({ length: count }, () => ({ tenders: emptyTenders })));
    setInputs(splitAmounts(total, count));
  }

  function patch(i: number, update: Partial<Share>) {
    setShares((current) => current.map((share, index) => index === i ? { ...share, ...update } : share));
  }

  async function payShare(i: number, parts: PaymentPart[]) {
    if (busy.current || shares[i].paid || !parts.length || !assignedValid || invalidPaidMethod) return;
    pay.reset();
    const next = shares.map((share, index) => index === i ? { ...share, paid: parts } : share);
    if (next.some(({ paid }) => !paid)) {
      setShares(next);
      return;
    }
    const splitPayments = next.flatMap(({ paid }) => paid ?? []);
    const method = splitPaymentMethod(splitPayments);
    if (!method) return;
    busy.current = true;
    try {
      await pay.mutateAsync({ orderId: order.id, method, splitPayments, expectedAmount: total });
      onPaid();
    } catch {
      // Confirmed parts stay marked. The last part can be retried.
    } finally {
      busy.current = false;
    }
  }

  if (openingShift) return <CashShiftEditor mode="open" current={null} onClose={() => setOpeningShift(false)} />;
  return (
    <BottomSheet visible title="Разделение счёта" onClose={() => { if (!busy.current) onClose(); }}
      bodyStyle={styles.body} footer={shiftRequired ? <Button title="Открыть кассовую смену" onPress={() => setOpeningShift(true)} /> :
        <View style={styles.spread}>
          <Text style={styles.label}>Осталось к оплате</Text><Text style={styles.total}>{money((splitCents(total) - paidCents) / 100)}</Text>
        </View>}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.spread}>
          <View>
            <Text style={styles.muted}>Сумма к оплате</Text>
            <Text style={styles.total}>{money(total)}</Text>
          </View>
          <View style={styles.row}>
            <Button title="−" variant="secondary" size="md" disabled={anyPaid || shares.length <= 2}
              onPress={() => changeCount(shares.length - 1)} />
            <Text accessibilityLabel={mode === 'equal' ? 'Количество гостей' : 'Количество платежей'} style={styles.label}>{shares.length}</Text>
            <Button title="+" variant="secondary" size="md" disabled={anyPaid || shares.length >= maxSplitShares(total)}
              onPress={() => changeCount(shares.length + 1)} />
          </View>
        </View>
        {!available.length && !settings.isPending && <Text style={styles.error}>Нет доступных способов оплаты</Text>}
        {!assignedValid && <Text style={styles.error}>Суммы всех платежей должны совпадать с итогом заказа.</Text>}
        {invalidPaidMethod && <Text style={styles.error}>Способ оплаты отмеченного платежа отключён.</Text>}
        {!!pay.error && <Text accessibilityRole="alert" style={styles.error}>{apiError(pay.error)}</Text>}
        {!shiftRequired && shares.map((share, i) => {
          const method = options.some(({ key }) => key === share.method) ? share.method : available.includes('cash') ? 'cash' : available[0];
          const amount = amounts[i];
          const mixed = method === 'mixed' ? mixedTender(splitCents(amount), share.tenders, available) : null;
          const parts: PaymentPart[] = method === 'mixed'
            ? mixed && !mixed.change ? ([
              { method: 'cash', amount: mixed.cashAmount },
              { method: 'card', amount: mixed.cardAmount },
              { method: 'qr', amount: mixed.qrAmount },
            ] satisfies PaymentPart[]).filter((part) => part.amount > 0) : []
            : method ? [{ method, amount }] : [];
          return <View style={styles.card} key={i}>
            <Text style={styles.label}>{mode === 'equal' ? 'Гость' : 'Платёж'} {i + 1}</Text>
            {mode === 'equal' || share.paid ? <Text style={styles.total}>{money(amount)}</Text>
              : <Field label="Сумма" value={inputs[i]} keyboardType="decimal-pad" editable={!pay.isPending}
                onChangeText={(value) => {
                  if (value && moneyCents(value) === null) return;
                  setInputs((current) => adjustSplitAmount(current, i, value.replace(',', '.'), shares.map(({ paid }) => !!paid), total));
                }} />}
            {share.paid ? (
              <Button title="Снять отметку" variant="secondary" size="md" disabled={pay.isPending} onPress={() => patch(i, { paid: undefined })} />
            ) : <>
              {options.length > 0 && <PillTabs items={options} value={method ?? ''}
                onChange={(value) => { if (!busy.current) patch(i, { method: value as PaymentMethod, tenders: emptyTenders }); }} />}
              {method === 'mixed' && available.map((tender) => <Field key={tender} label={tenderLabels[tender]}
                value={share.tenders[tender]} editable={!pay.isPending} keyboardType="decimal-pad"
                onChangeText={(value) => patch(i, { tenders: { ...share.tenders, [tender]: value } })} />)}
              {!!qrSrc && (method === 'qr' || Number(share.tenders.qr.replace(',', '.')) > 0) && (
                <Image source={{ uri: qrSrc }} accessibilityLabel="QR-код для оплаты" style={styles.qr} resizeMode="contain" />
              )}
              <Button title={'Оплатить · ' + money(amount)} onPress={() => void payShare(i, parts)}
                loading={pay.isPending} disabled={!assignedValid || invalidPaidMethod || !parts.length || (canManage && cashShift.isPending)} />
            </>}
          </View>;
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1 },
  content: { gap: spacing.sm },
  card: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  grow: { flex: 1 },
  label: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '600' },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  error: { color: colors.danger },
  total: { fontSize: fontSize.lg, color: colors.textPrimary, fontWeight: '700' },
  qr: { width: 160, height: 160, alignSelf: 'center' },
});
