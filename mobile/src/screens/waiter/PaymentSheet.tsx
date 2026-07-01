import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { fetchReceipt, useCreateReceiptPrintRequest, usePay } from '@/services/api/waiter';
import { usePublicSettings, resolveQrSrc } from '@/services/api/settings';
import { apiError } from '@/lib/api';
import { beep } from '@/lib/sound';
import { useNotifications } from '@/store/notifications';
import { useReceiptPrint } from '@/store/receiptPrint';
import {
  displayOrderNumber,
  hallSuffix,
  isSplitPayment,
  money,
  orderItemDisplayName,
  paymentMethodLabel,
} from '@/utils/format';
import type { Order, PaymentMethod, Receipt } from '@/types';

type SplitMethod = 'qr' | 'cash' | 'mixed';
type SplitPart = { method: Exclude<PaymentMethod, 'mixed'>; amount: number };
type PaymentPayload =
  | { orderId: string; method: PaymentMethod }
  | { orderId: string; method: 'mixed'; cashAmount: number; qrAmount: number }
  | { orderId: string; method: PaymentMethod; splitPayments: SplitPart[] };

const ALL_METHODS: { key: Exclude<PaymentMethod, 'mixed'>; label: string }[] = [
  { key: 'qr', label: 'QR-код' },
  { key: 'cash', label: 'Наличные' },
  { key: 'card', label: 'Карта' },
];
const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ['qr', 'cash'];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
  mixed: 'Смешанная',
};

const SPLIT_METHOD_LABELS: Record<SplitMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  mixed: 'Смешанная',
};
const SPLIT_METHODS: { key: SplitMethod; label: string }[] = [
  { key: 'qr', label: SPLIT_METHOD_LABELS.qr },
  { key: 'cash', label: SPLIT_METHOD_LABELS.cash },
  { key: 'mixed', label: SPLIT_METHOD_LABELS.mixed },
];

function amountValue(value: string): number {
  return Number(value.replace(',', '.')) || 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function splitAmounts(total: number, count: number): string[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, index) =>
    String((index === count - 1 ? cents - base * (count - 1) : base) / 100),
  );
}

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
  const print = useCreateReceiptPrintRequest();
  const push = useNotifications((s) => s.push);
  const beginPrint = useReceiptPrint((s) => s.begin);
  const [tab, setTab] = useState<PaymentMethod>('qr');
  const [cashInput, setCashInput] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [splitOpen, setSplitOpen] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [successDone, setSuccessDone] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const enabled = settings.data?.paymentMethods ?? DEFAULT_PAYMENT_METHODS;
  const qrSrc = resolveQrSrc(settings.data?.qrImageUrl);
  const mixedAvailable = enabled.includes('qr') && enabled.includes('cash');
  const tabs = useMemo(() => {
    const list: { key: PaymentMethod; label: string }[] = [
      ...ALL_METHODS.filter((method) => enabled.includes(method.key)),
    ];
    if (mixedAvailable) list.push({ key: 'mixed', label: METHOD_LABELS.mixed });
    return list;
  }, [enabled, mixedAvailable]);

  const close = () => {
    const paid = !!receipt;
    setReceipt(null);
    setSplitOpen(false);
    setSuccessVisible(false);
    setSuccessDone(false);
    setCashInput('');
    setQrInput('');
    setTab('qr');
    onClose();
    if (paid) onPaid();
  };

  React.useEffect(() => {
    if (!successVisible) return undefined;
    setSuccessDone(false);
    const timer = setTimeout(() => setSuccessDone(true), 1300);
    return () => clearTimeout(timer);
  }, [successVisible]);

  React.useEffect(() => {
    if (successVisible && successDone && receipt) setSuccessVisible(false);
  }, [receipt, successDone, successVisible]);

  if (!order) return null;

  const total = Number(order.finalAmount);
  const selected = tabs.some((item) => item.key === tab) ? tab : tabs[0]?.key ?? 'qr';
  const cashNum = amountValue(cashInput);
  const qrNum = amountValue(qrInput);
  const entered = round2(cashNum + qrNum);
  const remaining = round2(total - entered);
  const mixedValid = selected === 'mixed' && Math.abs(remaining) < 0.01;
  const qrMissing = selected === 'qr' && !qrSrc;
  const confirmDisabled = pay.isPending || qrMissing || (selected === 'mixed' && !mixedValid);

  const complement = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return String(Math.max(0, round2(total - amountValue(trimmed))));
  };
  const onCashChange = (value: string) => {
    setCashInput(value);
    setQrInput(complement(value));
  };
  const onQrChange = (value: string) => {
    setQrInput(value);
    setCashInput(complement(value));
  };

  const completePayment = async (payload: PaymentPayload) => {
    try {
      await pay.mutateAsync(payload);
    } catch (e) {
      push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
      throw e;
    }
    void beep('payment');
    push({ message: 'Оплата принята', type: 'success', at: new Date().toISOString() });
    setSplitOpen(false);
    setReceipt(null);
    setSuccessVisible(true);
    try {
      setReceipt(await fetchReceipt(order.id));
    } catch (e) {
      setSuccessVisible(false);
      push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
    }
  };

  const requestPrint = async () => {
    if (!receipt) return;
    try {
      const request = await print.mutateAsync({ orderId: order.id, type: 'receipt' });
      beginPrint(request, receipt);
      push({ message: 'Запрос на печать отправлен администратору', type: 'success', at: new Date().toISOString() });
      close();
    } catch (e) {
      push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
    }
  };

  const submit = () => {
    if (confirmDisabled) return;
    const payload: PaymentPayload = selected === 'mixed'
      ? { orderId: order.id, method: 'mixed', cashAmount: cashNum, qrAmount: qrNum }
      : { orderId: order.id, method: selected };
    void completePayment(payload).catch(() => undefined);
  };

  const handleSplitComplete = ({
    cash,
    qr,
    payments,
  }: {
    cash: number;
    qr: number;
    payments: SplitPart[];
  }) => {
    const splitMethod: PaymentMethod =
      cash > 0 && qr > 0 ? 'mixed' : qr > 0 ? 'qr' : 'cash';
    const payload: PaymentPayload = payments.length > 1
      ? { orderId: order.id, method: splitMethod, splitPayments: payments }
      : { orderId: order.id, method: splitMethod };
    return completePayment(payload);
  };

  return (
    <>
      <BottomSheet
        visible={visible && !successVisible && !receipt}
        onClose={close}
        title="Оплата заказа"
        footer={
          <View style={styles.payActions}>
            <Button
              title="Разделить счёт"
              variant="secondary"
              onPress={() => setSplitOpen(true)}
              disabled={pay.isPending}
              style={styles.splitButton}
            />
            <Button
              title={`${selected === 'cash' || selected === 'card' ? 'Принять оплату' : 'Оплачено'} · ${money(total)}`}
              onPress={submit}
              loading={pay.isPending}
              disabled={confirmDisabled}
              style={{ flex: 1 }}
            />
          </View>
        }
      >
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
          {tabs.map((item) => {
            const active = selected === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setTab(item.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.content}>
          {selected === 'qr' ? (
            <View style={styles.qrBox}>
              {qrSrc ? (
                <>
                  <Text style={styles.qrHint}>Покажите QR-код клиенту для оплаты</Text>
                  <Image source={{ uri: qrSrc }} style={styles.qrImage} resizeMode="contain" />
                </>
              ) : (
                <Text style={styles.qrMissing}>QR-код не настроен. Выберите другой способ оплаты.</Text>
              )}
            </View>
          ) : selected === 'cash' ? (
            <View style={styles.qrBox}>
              <Text style={styles.qrHint}>Примите оплату наличными — {money(total)}</Text>
            </View>
          ) : selected === 'card' ? (
            <View style={styles.qrBox}>
              <Text style={styles.qrHint}>Примите оплату картой через терминал — {money(total)}</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.md }}>
              <View style={styles.mixedRow}>
                <Text style={styles.mixedLabel}>Наличные</Text>
                <TextInput
                  value={cashInput}
                  onChangeText={onCashChange}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textLight}
                  style={styles.mixedInput}
                />
              </View>
              <View style={styles.mixedRow}>
                <Text style={styles.mixedLabel}>QR</Text>
                <TextInput
                  value={qrInput}
                  onChangeText={onQrChange}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textLight}
                  style={styles.mixedInput}
                />
              </View>
              <View style={styles.mixedSummary}>
                <View style={styles.mixedSummaryRow}>
                  <Text style={styles.mixedSummaryLabel}>Итого внесено</Text>
                  <Text style={styles.mixedSummaryValue}>{money(entered)}</Text>
                </View>
                <View style={styles.mixedSummaryRow}>
                  <Text style={styles.mixedSummaryLabel}>Осталось</Text>
                  <Text style={[styles.mixedSummaryValue, remaining < -0.01 && { color: colors.danger }]}>
                    {money(Math.max(0, remaining))}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </BottomSheet>

      <SplitBillSheet
        visible={splitOpen}
        orderId={order.id}
        total={total}
        submitting={pay.isPending}
        onClose={() => setSplitOpen(false)}
        onComplete={handleSplitComplete}
      />
      <ReceiptSheet
        receipt={receipt}
        visible={visible && !successVisible && !!receipt}
        printing={print.isPending}
        onClose={close}
        onPrint={() => void requestPrint()}
      />
      <PaymentSuccessOverlay visible={successVisible} total={total} />
    </>
  );
}

function ReceiptSheet({
  receipt,
  visible,
  printing,
  onClose,
  onPrint,
}: {
  receipt: Receipt | null;
  visible: boolean;
  printing: boolean;
  onClose: () => void;
  onPrint: () => void;
}) {
  if (!receipt) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Оплата принята"
      footer={
        <View style={styles.receiptActions}>
          <Button title="Готово" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Печать чека" loading={printing} onPress={onPrint} style={{ flex: 1 }} />
        </View>
      }
    >
      <View style={styles.receiptBox}>
        <Text style={styles.receiptCafe} numberOfLines={2}>{receipt.cafeName}</Text>
        <Text style={styles.receiptMeta}>
          {displayOrderNumber(receipt.orderNumber)} · Стол {receipt.tableNumber}
        </Text>
        <View style={styles.receiptItems}>
          {receipt.items.map((item, index) => (
            <View key={`${item.dishNameSnapshot}-${index}`} style={styles.receiptItemRow}>
              <Text style={styles.receiptItemName} numberOfLines={2}>
                {orderItemDisplayName(item)} <Text style={styles.receiptQty}>×{item.quantity}</Text>
              </Text>
              <Text style={styles.receiptItemPrice}>{money(item.finalPrice)}</Text>
            </View>
          ))}
        </View>
        {Number(receipt.serviceChargeAmount) > 0 ? (
          <View style={styles.receiptLine}>
            <Text style={styles.receiptLineLabel}>Обслуживание</Text>
            <Text style={styles.receiptLineValue}>{money(receipt.serviceChargeAmount)}</Text>
          </View>
        ) : null}
        <View style={styles.receiptTotal}>
          <Text style={styles.receiptTotalLabel}>Итого</Text>
          <Text style={styles.receiptTotalValue}>{money(receipt.finalAmount)}</Text>
        </View>
        {isSplitPayment(receipt) && receipt.payments?.length ? (
          <View style={styles.receiptPayments}>
            <View style={styles.receiptPaymentRow}>
              <Text style={styles.receiptPaymentTitle}>Раздельная оплата</Text>
              <Text style={styles.receiptPaymentTitle}>{money(receipt.finalAmount)}</Text>
            </View>
            {receipt.payments.map((payment, index) => (
              <View key={`${payment.method}-${index}`} style={styles.receiptPaymentRow}>
                <Text style={styles.receiptPaymentLabel}>
                  Платёж {index + 1} — {paymentMethodLabel(payment.method)}
                </Text>
                <Text style={styles.receiptPaymentAmount}>{money(payment.amount)}</Text>
              </View>
            ))}
          </View>
        ) : receipt.payments && receipt.payments.length > 1 ? (
          <View style={styles.receiptPayments}>
            {receipt.payments.map((payment, index) => (
              <View key={`${payment.method}-${index}`} style={styles.receiptPaymentRow}>
                <Text style={styles.receiptPaymentLabel}>{paymentMethodLabel(payment.method)}</Text>
                <Text style={styles.receiptPaymentAmount}>{money(payment.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function PaymentSuccessOverlay({ visible, total }: { visible: boolean; total: number }) {
  const card = React.useRef(new Animated.Value(0)).current;
  const check = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!visible) {
      card.setValue(0);
      check.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(card, {
        toValue: 1,
        duration: 280,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(120),
        Animated.timing(check, {
          toValue: 1,
          duration: 450,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [card, check, visible]);

  return (
    <RNModal visible={visible} transparent animationType="none" statusBarTranslucent={false}>
      <View style={styles.successBackdrop}>
        <Animated.View
          style={[
            styles.successCard,
            {
              opacity: card,
              transform: [
                {
                  scale: card.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.94, 1],
                  }),
                },
                {
                  translateY: card.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.successIcon,
              {
                opacity: check,
                transform: [
                  {
                    scale: check.interpolate({
                      inputRange: [0, 0.6, 1],
                      outputRange: [0.4, 1.12, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <PwaIcon name="check" size={34} color={colors.success} strokeWidth={2.5} />
          </Animated.View>
          <Text style={styles.successTitle}>Оплата принята</Text>
          <Text style={styles.successText}>Платёж успешно подтверждён</Text>
          <Text style={styles.successAmount}>{money(total)}</Text>
          <View style={styles.successProgress}>
            <ActivityIndicator size="small" color={colors.textLight} />
            <Text style={styles.successProgressText}>Переходим к чеку…</Text>
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

function SplitBillSheet({
  visible,
  orderId,
  total,
  submitting,
  onClose,
  onComplete,
}: {
  visible: boolean;
  orderId: string;
  total: number;
  submitting: boolean;
  onClose: () => void;
  onComplete: (totals: { cash: number; qr: number; payments: SplitPart[] }) => Promise<void>;
}) {
  const [count, setCount] = useState(2);
  const [completing, setCompleting] = useState(false);
  const [payments, setPayments] = useState(() =>
    Array.from({ length: 2 }, () => ({ method: 'qr' as SplitMethod, cash: '', qr: '', paid: false })),
  );
  const [amountInputs, setAmountInputs] = useState(() => splitAmounts(total, 2));

  React.useEffect(() => {
    setCount(2);
    setCompleting(false);
    setPayments(Array.from({ length: 2 }, () => ({ method: 'qr' as SplitMethod, cash: '', qr: '', paid: false })));
    setAmountInputs(splitAmounts(total, 2));
  }, [orderId, total]);

  const amounts = useMemo(() => amountInputs.map((value) => round2(amountValue(value))), [amountInputs]);
  const assignedSum = round2(amounts.reduce((sum, amount) => sum + amount, 0));
  const assignedValid = Math.abs(assignedSum - total) < 0.01;
  const anyPaid = payments.some((payment) => payment.paid);
  const paidSum = payments.reduce((sum, payment, index) => (payment.paid ? sum + amounts[index] : sum), 0);
  const remaining = round2(total - paidSum);
  const busy = submitting || completing;

  const changeCount = (next: number) => {
    if (anyPaid) return;
    const normalized = Math.max(2, Math.min(10, next));
    setCount(normalized);
    setPayments(Array.from({ length: normalized }, () => ({ method: 'qr' as SplitMethod, cash: '', qr: '', paid: false })));
    setAmountInputs(splitAmounts(total, normalized));
  };

  const patchPayment = (index: number, patch: Partial<{ method: SplitMethod; cash: string; qr: string; paid: boolean }>) => {
    setPayments((current) => current.map((payment, i) => (i === index ? { ...payment, ...patch } : payment)));
  };

  const onAmountChange = (index: number, value: string) => {
    if (payments[index]?.paid) return;
    const clean = value.replace(',', '.');
    setAmountInputs((current) => {
      const next = [...current];
      next[index] = clean;
      const adjustIndex =
        payments.findIndex((payment, i) => i !== index && !payment.paid && i > index) >= 0
          ? payments.findIndex((payment, i) => i !== index && !payment.paid && i > index)
          : [...payments.keys()].reverse().find((i) => i !== index && !payments[i].paid);
      if (adjustIndex !== undefined && adjustIndex >= 0) {
        const others = next.reduce((sum, amount, i) => (i === adjustIndex ? sum : sum + amountValue(amount)), 0);
        next[adjustIndex] = String(Math.max(0, round2(total - others)));
      }
      return next;
    });
  };

  const onMixedCash = (index: number, value: string) => {
    const rest = round2(amounts[index] - amountValue(value));
    patchPayment(index, { cash: value, qr: value.trim() === '' ? '' : String(Math.max(0, rest)) });
  };

  const onMixedQr = (index: number, value: string) => {
    const rest = round2(amounts[index] - amountValue(value));
    patchPayment(index, { qr: value, cash: value.trim() === '' ? '' : String(Math.max(0, rest)) });
  };

  const canPay = (index: number) => {
    const payment = payments[index];
    if (!payment || payment.paid || amounts[index] <= 0 || !assignedValid) return false;
    if (payment.method !== 'mixed') return true;
    const cash = amountValue(payment.cash);
    const qr = amountValue(payment.qr);
    return cash > 0 && qr > 0 && Math.abs(cash + qr - amounts[index]) < 0.01;
  };

  const payOne = async (index: number) => {
    if (!canPay(index) || busy) return;
    const next = payments.map((payment, i) => (i === index ? { ...payment, paid: true } : payment));
    setPayments(next);
    if (!next.every((payment) => payment.paid)) return;

    let cash = 0;
    let qr = 0;
    const splitParts: SplitPart[] = [];
    next.forEach((payment, i) => {
      const amount = amounts[i];
      if (payment.method === 'qr') {
        qr += amount;
        splitParts.push({ method: 'qr', amount });
      } else if (payment.method === 'cash') {
        cash += amount;
        splitParts.push({ method: 'cash', amount });
      } else {
        const cashPart = round2(amountValue(payment.cash));
        const qrPart = round2(amountValue(payment.qr));
        cash += cashPart;
        qr += qrPart;
        if (cashPart > 0) splitParts.push({ method: 'cash', amount: cashPart });
        if (qrPart > 0) splitParts.push({ method: 'qr', amount: qrPart });
      }
    });

    setCompleting(true);
    try {
      await onComplete({ cash: round2(cash), qr: round2(qr), payments: splitParts });
    } finally {
      setCompleting(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Разделение счёта" maxHeight="88%">
      <View style={styles.splitHeader}>
        <View>
          <Text style={styles.splitHint}>Сумма к оплате</Text>
          <Text style={styles.splitTotal}>{money(total)}</Text>
        </View>
        <View style={styles.counter}>
          <CounterButton label="-" disabled={anyPaid || count <= 2} onPress={() => changeCount(count - 1)} />
          <Text style={styles.counterValue}>{count}</Text>
          <CounterButton label="+" disabled={anyPaid || count >= 10} onPress={() => changeCount(count + 1)} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
          <View style={styles.splitList}>
            {payments.map((payment, index) => (
              <View key={index} style={[styles.splitCard, payment.paid && styles.splitCardPaid]}>
                <View style={styles.splitTopRow}>
                  <Text style={styles.splitTitle}>Платёж {index + 1}</Text>
                  {payment.paid ? (
                    <Text style={styles.splitAmountText}>{money(amounts[index])}</Text>
                  ) : (
                    <TextInput
                      value={amountInputs[index] ?? ''}
                      onChangeText={(value) => onAmountChange(index, value)}
                      keyboardType="decimal-pad"
                      editable={!busy}
                      style={styles.splitAmountInput}
                    />
                  )}
                </View>

                {payment.paid ? (
                  <Text style={styles.paidText}>Оплачен · {SPLIT_METHOD_LABELS[payment.method]}</Text>
                ) : (
                  <>
                    <View style={styles.splitMethodRow}>
                      {SPLIT_METHODS.map((method) => {
                        const active = payment.method === method.key;
                        return (
                          <Pressable
                            key={method.key}
                            disabled={busy}
                            onPress={() => patchPayment(index, { method: method.key })}
                            style={[styles.splitMethod, active && styles.splitMethodActive]}
                          >
                            <Text style={[styles.splitMethodText, active && styles.splitMethodTextActive]} numberOfLines={1}>
                              {method.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {payment.method === 'mixed' ? (
                      <View style={styles.splitMixedGrid}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.splitInputLabel}>Наличные</Text>
                          <TextInput
                            value={payment.cash}
                            onChangeText={(value) => onMixedCash(index, value)}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            style={styles.splitMixedInput}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.splitInputLabel}>QR</Text>
                          <TextInput
                            value={payment.qr}
                            onChangeText={(value) => onMixedQr(index, value)}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            style={styles.splitMixedInput}
                          />
                        </View>
                      </View>
                    ) : null}

                    <Button
                      title={`Оплатить · ${money(amounts[index])}`}
                      size="md"
                      onPress={() => void payOne(index)}
                      loading={busy && index === payments.findIndex((item) => !item.paid)}
                      disabled={!canPay(index) || busy}
                    />
                  </>
                )}
              </View>
            ))}
            {!assignedValid ? (
              <Text style={styles.splitError}>Сумма платежей должна быть равна {money(total)}</Text>
            ) : null}
          </View>
      </ScrollView>

      <View style={styles.splitFooter}>
        <Text style={styles.splitHint}>Осталось к оплате</Text>
        <Text style={[styles.splitRemaining, remaining <= 0 && { color: colors.success }]}>
          {money(Math.max(0, remaining))}
        </Text>
      </View>
    </BottomSheet>
  );
}

function CounterButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.counterButton, disabled && { opacity: 0.4 }]}>
      <Text style={styles.counterButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  totalLabel: { fontSize: fontSize.md, color: colors.textSecondary },
  totalValue: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
  sectionLabel: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tab: {
    minWidth: '30%',
    flexGrow: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  tabActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  tabText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
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
  qrMissing: { fontSize: fontSize.sm, color: colors.textLight, textAlign: 'center', paddingVertical: spacing.lg },
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
  mixedSummary: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  mixedSummaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  mixedSummaryLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  mixedSummaryValue: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  payActions: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  splitButton: { width: 148 },
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  successCard: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 16,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { marginTop: spacing.lg, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  successText: { marginTop: 4, fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  successAmount: { marginTop: spacing.md, fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  successProgress: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  successProgressText: { fontSize: fontSize.xs, color: colors.textLight },
  receiptActions: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  receiptBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  receiptCafe: { textAlign: 'center', fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  receiptMeta: { marginTop: 4, marginBottom: spacing.md, textAlign: 'center', fontSize: fontSize.xs, color: colors.textMuted },
  receiptItems: { gap: 6 },
  receiptItemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  receiptItemName: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 18 },
  receiptQty: { color: colors.textLight },
  receiptItemPrice: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  receiptLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  receiptLineLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  receiptLineValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  receiptTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  receiptTotalLabel: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '700' },
  receiptTotalValue: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '700' },
  receiptPayments: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm, gap: 4 },
  receiptPaymentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  receiptPaymentTitle: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '700' },
  receiptPaymentLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  receiptPaymentAmount: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  splitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  splitHint: { fontSize: fontSize.sm, color: colors.textMuted },
  splitTotal: { marginTop: 2, fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  counter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  counterButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterButtonText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textSecondary },
  counterValue: { minWidth: 24, textAlign: 'center', fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  splitList: { gap: spacing.sm, paddingBottom: spacing.md },
  splitCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  splitCardPaid: { borderColor: 'rgba(22,163,74,0.36)', backgroundColor: colors.successSoft },
  splitTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  splitTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  splitAmountText: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  splitAmountInput: {
    width: 104,
    height: 38,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    textAlign: 'right',
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  splitMethodRow: { flexDirection: 'row', gap: spacing.sm },
  splitMethod: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  splitMethodActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  splitMethodText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary },
  splitMethodTextActive: { color: colors.primary },
  splitMixedGrid: { flexDirection: 'row', gap: spacing.sm },
  splitInputLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: 4 },
  splitMixedInput: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    textAlign: 'right',
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  paidText: { fontSize: fontSize.sm, color: colors.success, fontWeight: '700' },
  splitError: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center', paddingTop: spacing.sm },
  splitFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  splitRemaining: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
});
