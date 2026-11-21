import { View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { colors, spacing } from '@/theme';
import { displayOrderNumber, money } from '@/utils/format';
import type { Order, PaymentMethod } from '@/types';
import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { orderLocation } from './orderRules';
import { normalizeAmount, quickCashAmounts, tenderTotals, type TenderAmounts, type TenderMethod } from './paymentAmounts';

const methods: { key: TenderMethod; label: string; icon: PwaIconName }[] = [
  { key: 'cash', label: 'Наличные', icon: 'adminReconcile' },
  { key: 'card', label: 'Карта', icon: 'adminReconcile' },
  { key: 'qr', label: 'QR-код', icon: 'qr' },
];
const empty = { cash: '', card: '', qr: '' };
const rows = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], ['.', '0', '⌫']];

export function WidePayment({ order, enabled, qrConfigured, served, busy, error, onSplit, onConfirm }: {
  order: Order;
  enabled: PaymentMethod[];
  qrConfigured: boolean;
  served: boolean;
  busy: boolean;
  error: string;
  onSplit: () => void;
  onConfirm: (amounts: TenderAmounts, active: TenderMethod) => void;
}) {
  const { height } = useWindowDimensions();
  const keyHeight = Math.min(116, Math.max(48, (height - 160) / 6));
  const [draft, setDraft] = React.useState(empty);
  const [active, setActive] = React.useState<TenderMethod>();
  const replaceAmount = React.useRef(true);
  const available = methods.filter(({ key }) => enabled.includes(key));
  const selected = active && enabled.includes(active) ? active : undefined;
  const total = Number(order.finalAmount);
  const entered: TenderAmounts = {
    cash: enabled.includes('cash') ? Number(draft.cash) || 0 : 0,
    card: enabled.includes('card') ? Number(draft.card) || 0 : 0,
    qr: enabled.includes('qr') ? Number(draft.qr) || 0 : 0,
  };
  const { amounts, remaining, change, over } = tenderTotals(total, entered);
  const showQrWarning = !qrConfigured && (selected === 'qr' || entered.qr > 0);
  const qrMissing = !qrConfigured && (entered.qr > 0 || total === 0 && selected === 'qr');
  const presets = enabled.includes('cash') ? quickCashAmounts(amounts.cash + remaining) : [];
  const canConfirm = !!selected && served && !busy && !remaining && !over && !qrMissing;

  function activate(method: TenderMethod) {
    if (selected !== method) replaceAmount.current = true;
    setActive(method);
    if (entered[method] > 0) return;
    replaceAmount.current = true;
    if (remaining > 0) setDraft((current) => ({ ...current, [method]: String(remaining) }));
    else if (!over && available.filter(({ key }) => entered[key] > 0).length === 1) {
      setDraft({ ...empty, [method]: String(total) });
    }
  }

  function changeAmount(method: TenderMethod, value: string) {
    const next = normalizeAmount(value);
    if (next === null) return;
    setDraft((current) => ({ ...current, [method]: next }));
    replaceAmount.current = false;
  }

  function pressKey(key: string) {
    if (!selected) return;
    const value = draft[selected];
    if (key === 'C') changeAmount(selected, '');
    else if (key === '⌫') changeAmount(selected, value.slice(0, -1));
    else {
      const base = replaceAmount.current || value === '0' && key !== '.' ? '' : value;
      changeAmount(selected, base + key);
    }
  }

  function exactAmount() {
    if (!selected) return;
    const other = available.reduce((sum, { key }) => key === selected ? sum : sum + Math.round(entered[key] * 100), 0);
    changeAmount(selected, String(Math.max(0, Math.round(total * 100) - other) / 100));
    replaceAmount.current = true;
  }

  return (
    <View style={styles.layout}>
      <View style={styles.keypad}>
        {presets.length > 0 && <View style={styles.buttonRow}>
          {presets.map((preset) => <PaymentKey key={preset} height={keyHeight} label={money(preset)}
            disabled={busy || !!selected && selected !== 'cash'} onPress={() => {
              setActive('cash');
              changeAmount('cash', String(preset));
              replaceAmount.current = true;
            }} />)}
        </View>}
        {rows.map((row) => <View key={row[0]} style={styles.buttonRow}>
          {row.map((key) => <PaymentKey key={key} height={keyHeight} label={key}
            accessibilityLabel={key === '⌫' ? 'Удалить последнюю цифру' : undefined}
            disabled={busy || !selected} onPress={() => pressKey(key)} />)}
        </View>)}
        <View style={styles.buttonRow}>
          <PaymentKey height={keyHeight} label="Точная сумма" disabled={busy || !selected} wide onPress={exactAmount} />
          <PaymentKey height={keyHeight} label="C" accessibilityLabel="Очистить сумму"
            disabled={busy || !selected} onPress={() => pressKey('C')} />
        </View>
      </View>
      <View style={styles.checkout}>
        <Text style={styles.muted}>{orderLocation(order)} · {displayOrderNumber(order.orderNumber)}</Text>
        <View style={styles.summary}>
          <Text style={styles.label} translate>К оплате</Text><Text style={styles.total}>{money(total)}</Text>
        </View>
        {!served && <Text style={styles.alert} accessibilityRole="alert" translate>Нельзя принять оплату: есть неподанные блюда.</Text>}
        <Text style={styles.muted} translate>Способ оплаты</Text>
        {available.map(({ key, icon, label }) => (
          <View key={key} style={[styles.method, selected === key && styles.selected]}>
            <FastPressable accessibilityRole="button" accessibilityState={{ selected: selected === key, disabled: busy }}
              style={styles.methodLabel} disabled={busy} onPress={() => activate(key)}>
              <PwaIcon size={22} name={icon} color={selected === key ? colors.primary : colors.textMuted} />
              <Text style={styles.label} translate>{label}</Text>
            </FastPressable>
            <TextInput accessibilityLabel={label} value={draft[key]} placeholder="0" showSoftInputOnFocus={false}
              style={styles.input} editable={!busy} onPressIn={() => activate(key)} onFocus={() => setActive(key)}
              onChangeText={(value) => changeAmount(key, value)} />
            <Text style={styles.muted}>с</Text>
            {key === 'cash' && !over && change > 0 && <Text style={styles.change} translate>{`Сдача ${money(change)}`}</Text>}
          </View>
        ))}
        {showQrWarning && <Text style={styles.alert} accessibilityRole="alert" translate>QR-код не загружен. Добавьте его в настройках или выберите другой способ оплаты.</Text>}
        {over ? <Text style={styles.alert} accessibilityRole="alert" translate>Сумма превышает итог заказа</Text> : (
          <View style={[styles.summary, styles.separator]}><Text style={styles.muted} translate>Осталось к оплате</Text><Text style={styles.label}>{money(remaining)}</Text></View>
        )}
        {!!error && <Text style={styles.alert} accessibilityRole="alert">{error}</Text>}
        <View style={styles.actions}>
          <PaymentKey height={56} label="Разделить счёт" compact disabled={busy || !served || total <= 0 || !available.length} onPress={onSplit} />
          <PaymentKey height={56} label={busy ? 'Оплата…' : 'Принять оплату'} compact primary
            disabled={!canConfirm} onPress={() => { if (canConfirm && selected) onConfirm(amounts, selected); }} />
        </View>
      </View>
    </View>
  );
}

function PaymentKey({ label, height, wide, compact, primary, disabled, accessibilityLabel, onPress }: {
  label: string; height: number; wide?: boolean; compact?: boolean; primary?: boolean;
  disabled: boolean; accessibilityLabel?: string; onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const motion = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[{ flex: wide ? 2 : 1 }, motion]}>
      <FastPressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled}
        style={({ pressed }) => [styles.key, { minHeight: height }, primary && styles.primary,
          disabled && styles.disabled, pressed && styles.pressed]}
        onPress={() => {
          if (!reduceMotion) scale.value = withSequence(withTiming(0.96, { duration: 48 }), withTiming(1, { duration: 112 }));
          onPress();
        }}>
        <Text style={[styles.keyText, (compact || wide) && styles.smallKey, primary && styles.primaryText]} translate>{label}</Text>
      </FastPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layout: { flexDirection: 'row', flexGrow: 1, minHeight: '100%' },
  keypad: { flex: 2, borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.sm },
  checkout: { flex: 3, minWidth: 0, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.card },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  total: { fontSize: 34, fontWeight: '700', color: colors.textPrimary },
  muted: { color: colors.textMuted, fontSize: 15 },
  label: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  method: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, minHeight: 60, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: 12, borderColor: colors.border },
  selected: { borderColor: colors.primary, backgroundColor: colors.background },
  methodLabel: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm, alignSelf: 'stretch' },
  input: { width: '34%', textAlign: 'right', fontSize: 25, fontWeight: '600', color: colors.textPrimary, paddingVertical: 8 },
  change: { flexBasis: '100%', textAlign: 'right', color: colors.textMuted, marginBottom: 6 },
  separator: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  alert: { color: colors.danger },
  actions: { flexDirection: 'row', marginTop: 'auto', paddingTop: spacing.md, gap: spacing.sm },
  buttonRow: { flexDirection: 'row', gap: spacing.sm },
  key: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card },
  keyText: { textAlign: 'center', color: colors.textPrimary, fontSize: 32, fontWeight: '600', fontVariant: ['tabular-nums'] },
  smallKey: { fontSize: 18 },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  primaryText: { color: colors.white },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
});
