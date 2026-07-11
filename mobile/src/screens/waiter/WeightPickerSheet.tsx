import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button } from '@/components/ui';
import { colors, fontSize, radius, softShadow, spacing } from '@/theme';
import { dishUnitPrice, money } from '@/utils/format';
import type { Dish } from '@/types';

const BASE_DIAL_MAX = 1000;
const DEFAULT_AMOUNT = 500;
const STEP = 10;
const START_ANGLE = 135;
const END_ANGLE = 405;

function polar(cx: number, cy: number, radiusValue: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radiusValue * Math.cos(radians), y: cy + radiusValue * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radiusValue: number, from: number, to: number) {
  const start = polar(cx, cy, radiusValue, to);
  const end = polar(cx, cy, radiusValue, from);
  return `M ${start.x} ${start.y} A ${radiusValue} ${radiusValue} 0 ${to - from <= 180 ? 0 : 1} 0 ${end.x} ${end.y}`;
}

function clampAmount(value: number) {
  return Math.max(0, Math.round(value / STEP) * STEP);
}

function amountLabel(value: number, measure: Dish['weightedMeasure']) {
  const volume = measure === 'volume';
  if (value < 1000) return { value: String(value), unit: volume ? 'мл' : 'г' };
  const scaled = value / 1000;
  return {
    value: Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''),
    unit: volume ? 'л' : 'кг',
  };
}

export function WeightPickerSheet({ dish, onClose, onAdd }: { dish: Dish | null; onClose: () => void; onAdd: (amount: number) => void }) {
  const { width } = useWindowDimensions();
  const dialSize = Math.min(236, Math.max(188, width - 152));
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(DEFAULT_AMOUNT));

  useEffect(() => {
    if (!dish) return;
    setAmount(DEFAULT_AMOUNT);
    setInput(String(DEFAULT_AMOUNT));
    setEditing(false);
  }, [dish]);

  const dialMax = Math.max(BASE_DIAL_MAX, Math.ceil(amount / BASE_DIAL_MAX) * BASE_DIAL_MAX);
  const angle = START_ANGLE + (amount / dialMax) * (END_ANGLE - START_ANGLE);
  const knob = polar(180, 180, 116, angle);
  const measure = dish?.weightedMeasure ?? 'weight';
  const display = amountLabel(amount, measure);
  const ticks = useMemo(() => Array.from({ length: 51 }, (_, index) => {
    const tickAngle = START_ANGLE + (index / 50) * (END_ANGLE - START_ANGLE);
    const major = index % 5 === 0;
    return { major, inner: polar(180, 180, major ? 137 : 143, tickAngle), outer: polar(180, 180, 151, tickAngle) };
  }), []);

  if (!dish) return null;
  const price = dishUnitPrice(String(Number(dish.price) * amount / (dish.weightedPriceBase ?? 100)), dish.discountType, dish.discountValue);
  const changeFromTouch = (x: number, y: number) => {
    let pointerAngle = (Math.atan2((y / dialSize) * 360 - 180, (x / dialSize) * 360 - 180) * 180) / Math.PI + 90;
    if (pointerAngle < START_ANGLE) pointerAngle += 360;
    pointerAngle = Math.max(START_ANGLE, Math.min(END_ANGLE, pointerAngle));
    setAmount(clampAmount(((pointerAngle - START_ANGLE) / (END_ANGLE - START_ANGLE)) * dialMax));
  };
  const commitInput = () => {
    const next = Number(input);
    setAmount(clampAmount(Number.isFinite(next) ? next : amount));
    setEditing(false);
  };

  return (
    <BottomSheet visible onClose={onClose} sheet title={measure === 'volume' ? 'Выберите объём' : 'Выберите вес'} footer={<Button title="Добавить" onPress={() => onAdd(amount)} disabled={amount <= 0} />} maxHeight="92%">
      <Text style={styles.name}>{dish.name}</Text>
      <View style={styles.dialRow}>
        <View style={styles.steps}>
          <Step label="−50" disabled={amount === 0} onPress={() => setAmount((value) => clampAmount(value - 50))} />
          <Step label="−100" disabled={amount === 0} onPress={() => setAmount((value) => clampAmount(value - 100))} />
          <Step label="−200" disabled={amount === 0} onPress={() => setAmount((value) => clampAmount(value - 200))} />
        </View>
        <View
          style={{ width: dialSize, height: dialSize }}
          onStartShouldSetResponder={() => !editing}
          onMoveShouldSetResponder={() => !editing}
          onResponderGrant={(event) => changeFromTouch(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderMove={(event) => changeFromTouch(event.nativeEvent.locationX, event.nativeEvent.locationY)}
        >
          <Svg width={dialSize} height={dialSize} viewBox="0 0 360 360">
            <Defs><LinearGradient id="weightedProgress" x1="70" y1="300" x2="300" y2="65"><Stop offset="0" stopColor="#9cc4ff" /><Stop offset="0.55" stopColor="#1672f9" /><Stop offset="1" stopColor="#075ce5" /></LinearGradient></Defs>
            {ticks.map((tick, index) => <Line key={index} x1={tick.inner.x} y1={tick.inner.y} x2={tick.outer.x} y2={tick.outer.y} stroke={index / 50 <= amount / dialMax ? '#2478ef' : '#d6deea'} strokeWidth={tick.major ? 2.4 : 1.7} strokeLinecap="round" />)}
            <Circle cx="180" cy="180" r="110" fill={colors.white} />
            <Path d={arcPath(180, 180, 116, START_ANGLE, END_ANGLE)} fill="none" stroke="#e9eef5" strokeWidth="7" strokeLinecap="round" />
            {amount > 0 ? <Path d={arcPath(180, 180, 116, START_ANGLE, angle)} fill="none" stroke="url(#weightedProgress)" strokeWidth="7" strokeLinecap="round" /> : null}
            <Circle cx={knob.x} cy={knob.y} r="11" fill={colors.white} stroke="#1268ee" strokeWidth="7" />
            {!editing ? <><SvgText x="180" y="197" textAnchor="middle" fill="#07152d" fontSize="48" fontWeight="700">{display.value}</SvgText><SvgText x="180" y="226" textAnchor="middle" fill="#60708d" fontSize="19" fontWeight="600">{display.unit}</SvgText></> : null}
            {[{ x: 180, y: 27, value: dialMax / 2 }, { x: 40, y: 130, value: dialMax / 4 }, { x: 320, y: 130, value: dialMax * 3 / 4 }, { x: 71, y: 322, value: 0 }, { x: 289, y: 322, value: dialMax }].map((mark, index) => { const label = amountLabel(mark.value, measure); return <SvgText key={index} x={mark.x} y={mark.y} textAnchor="middle" fill="#60708d" fontSize="14">{`${label.value} ${label.unit}`}</SvgText>; })}
          </Svg>
          {editing ? <TextInput autoFocus value={input} onChangeText={setInput} onBlur={commitInput} onSubmitEditing={commitInput} keyboardType="number-pad" selectTextOnFocus style={styles.amountInput} /> : <FastPressable style={styles.editHitbox} onPress={() => { setInput(String(amount)); setEditing(true); }} />}
        </View>
        <View style={styles.steps}>
          <Step label="+50" onPress={() => setAmount((value) => clampAmount(value + 50))} />
          <Step label="+100" onPress={() => setAmount((value) => clampAmount(value + 100))} />
          <Step label="+200" onPress={() => setAmount((value) => clampAmount(value + 200))} />
        </View>
      </View>
      <View style={styles.priceRow}><Text style={styles.priceLabel}>Стоимость</Text><Text style={styles.price}>{money(price)}</Text></View>
    </BottomSheet>
  );
}

function Step({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <FastPressable disabled={disabled} onPress={onPress} style={[styles.step, disabled && styles.disabled]}><Text style={styles.stepText}>{label}</Text></FastPressable>;
}

const styles = StyleSheet.create({
  name: { marginBottom: spacing.md, textAlign: 'center', fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  dialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  steps: { width: 58, gap: spacing.sm },
  step: { height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white, ...softShadow },
  stepText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  disabled: { opacity: 0.35 },
  editHitbox: { position: 'absolute', left: '28%', top: '34%', width: '44%', height: '34%', borderRadius: radius.pill },
  amountInput: { position: 'absolute', left: '28%', top: '40%', width: '44%', height: 54, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, backgroundColor: colors.white, textAlign: 'center', fontSize: 27, fontWeight: '700', color: colors.textPrimary },
  priceRow: { minHeight: 62, marginTop: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  priceLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  price: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
});
