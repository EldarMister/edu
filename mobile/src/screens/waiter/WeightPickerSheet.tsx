import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText, TSpan } from 'react-native-svg';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Button } from '@/components/ui';
import { colors, radius, softShadow, spacing } from '@/theme';
import { dishUnitPrice, money } from '@/utils/format';
import type { Dish } from '@/types';

const BASE_DIAL_MAX = 1000;
const DEFAULT_AMOUNT = 500;
const STEP = 10;
const START_ANGLE = 135;
const END_ANGLE = 405;

function polar(cx: number, cy: number, radiusValue: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: cx + radiusValue * Math.cos(radians), y: cy + radiusValue * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radiusValue: number, from: number, to: number) {
  const start = polar(cx, cy, radiusValue, from);
  const end = polar(cx, cy, radiusValue, to);
  return `M ${start.x} ${start.y} A ${radiusValue} ${radiusValue} 0 ${to - from > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
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

export function WeightPickerSheet({
  dish,
  onClose,
  onAdd,
}: {
  dish: Dish | null;
  onClose: () => void;
  onAdd: (amount: number) => void;
}) {
  const { width, height } = useWindowDimensions();
  const dialSize = Math.min(292, Math.max(214, width - 140));
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(DEFAULT_AMOUNT));
  const dragRef = useRef<{ lastAngle: number; scale: number } | null>(null);

  useEffect(() => {
    if (!dish) return;
    setAmount(DEFAULT_AMOUNT);
    setInput(String(DEFAULT_AMOUNT));
    setEditing(false);
    dragRef.current = null;
  }, [dish]);

  const dialMax = Math.max(BASE_DIAL_MAX, Math.ceil(amount / BASE_DIAL_MAX) * BASE_DIAL_MAX);
  const angle = START_ANGLE + (amount / dialMax) * (END_ANGLE - START_ANGLE);
  const knob = polar(180, 180, 116, angle);
  const measure = dish?.weightedMeasure ?? 'weight';
  const display = amountLabel(amount, measure);
  const ticks = useMemo(
    () =>
      Array.from({ length: 51 }, (_, index) => {
        const tickAngle = START_ANGLE + (index / 50) * (END_ANGLE - START_ANGLE);
        const major = index % 5 === 0;
        return {
          major,
          inner: polar(180, 180, major ? 132 : 137, tickAngle),
          outer: polar(180, 180, 144, tickAngle),
        };
      }),
    [],
  );

  if (!dish) return null;

  const price = dishUnitPrice(
    String((Number(dish.price) * amount) / (dish.weightedPriceBase ?? 100)),
    dish.discountType,
    dish.discountValue,
  );

  const pointerAngle = (x: number, y: number) => {
    const svgX = (x / dialSize) * 360;
    const svgY = (y / dialSize) * 360;
    return (((Math.atan2(svgY - 180, svgX - 180) * 180) / Math.PI) + 360) % 360;
  };

  const beginDial = (x: number, y: number) => {
    const raw = pointerAngle(x, y);
    dragRef.current = { lastAngle: raw, scale: dialMax };
    let selected = raw;
    if (selected < START_ANGLE) selected += 360;
    selected = Math.max(START_ANGLE, Math.min(END_ANGLE, selected));
    setAmount(clampAmount(((selected - START_ANGLE) / (END_ANGLE - START_ANGLE)) * dialMax));
  };

  const moveDial = (x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const raw = pointerAngle(x, y);
    let delta = raw - drag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    drag.lastAngle = raw;
    setAmount((current) => clampAmount(current + (delta / (END_ANGLE - START_ANGLE)) * drag.scale));
  };

  const commitInput = () => {
    const next = Number(input);
    setAmount(clampAmount(Number.isFinite(next) ? next : amount));
    setEditing(false);
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      sheet
      maxHeight="94%"
      fillBody
      animationPreset="weight"
      panelStyle={styles.panel}
      bodyStyle={styles.sheetBody}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { minHeight: Math.min(height * 0.55, 560) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{dish.name}</Text>
            <Text style={styles.subtitle}>{measure === 'volume' ? 'Выберите объём' : 'Выберите вес'}</Text>
          </View>
          <FastPressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
            <PwaIcon name="close" size={23} color="#334155" strokeWidth={2} />
          </FastPressable>
        </View>

        <View style={styles.dialRow}>
          <View style={[styles.steps, styles.leftSteps]}>
            <Step label="−50" disabled={amount === 0} onPress={() => setAmount((value) => clampAmount(value - 50))} />
            <Step label="−100" disabled={amount === 0} onPress={() => setAmount((value) => clampAmount(value - 100))} />
          </View>

          <View
            style={{ width: dialSize, height: dialSize }}
            onStartShouldSetResponder={() => !editing}
            onMoveShouldSetResponder={() => !editing}
            onResponderGrant={(event) => beginDial(event.nativeEvent.locationX, event.nativeEvent.locationY)}
            onResponderMove={(event) => moveDial(event.nativeEvent.locationX, event.nativeEvent.locationY)}
            onResponderRelease={() => { dragRef.current = null; }}
            onResponderTerminate={() => { dragRef.current = null; }}
          >
            <View pointerEvents="none" style={styles.dialShadow} />
            <Svg width={dialSize} height={dialSize} viewBox="0 0 360 360">
              <Defs>
                <LinearGradient id="weightedProgress" x1="50" y1="270" x2="300" y2="65" gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor="#9cc4ff" />
                  <Stop offset="0.55" stopColor="#1672f9" />
                  <Stop offset="1" stopColor="#075ce5" />
                </LinearGradient>
              </Defs>
              {ticks.map((tick, index) => (
                <Line
                  key={index}
                  x1={tick.inner.x}
                  y1={tick.inner.y}
                  x2={tick.outer.x}
                  y2={tick.outer.y}
                  stroke={index / 50 <= amount / dialMax ? '#2478ef' : '#d6deea'}
                  strokeWidth={tick.major ? 2.4 : 1.7}
                  strokeLinecap="round"
                />
              ))}
              <Circle cx="180" cy="180" r="110" fill={colors.white} />
              <Path d={arcPath(180, 180, 116, START_ANGLE, END_ANGLE)} fill="none" stroke="#e9eef5" strokeWidth="7" strokeLinecap="round" />
              {amount > 0 ? <Path d={arcPath(180, 180, 116, START_ANGLE, angle)} fill="none" stroke="url(#weightedProgress)" strokeWidth="7" strokeLinecap="round" /> : null}
              <Circle cx={knob.x} cy={knob.y} r="11" fill={colors.white} stroke="#1268ee" strokeWidth="7" />
              {!editing ? (
                <SvgText x="180" y="197" textAnchor="middle" fill="#07152d" fontWeight="700">
                  <TSpan fontSize="50">{display.value}</TSpan>
                  <TSpan fontSize="22" fontWeight="600"> {display.unit}</TSpan>
                </SvgText>
              ) : null}
              <DialMark x={180} y={27} value={dialMax / 2} measure={measure} />
              <DialMark x={40} y={130} value={dialMax / 4} measure={measure} />
              <DialMark x={320} y={130} value={(dialMax * 3) / 4} measure={measure} />
              <SvgText x="71" y="322" textAnchor="middle" fill="#60708d" fontSize="15">0</SvgText>
              <DialMark x={289} y={322} value={dialMax} measure={measure} />
            </Svg>
            {editing ? (
              <TextInput
                autoFocus
                value={input}
                onChangeText={setInput}
                onBlur={commitInput}
                onSubmitEditing={commitInput}
                keyboardType="number-pad"
                selectTextOnFocus
                style={styles.amountInput}
              />
            ) : (
              <FastPressable
                style={styles.editHitbox}
                onPress={() => {
                  setInput(String(amount));
                  setEditing(true);
                }}
              />
            )}
          </View>

          <View style={[styles.steps, styles.rightSteps]}>
            <Step label="+50" onPress={() => setAmount((value) => clampAmount(value + 50))} />
            <Step label="+100" onPress={() => setAmount((value) => clampAmount(value + 100))} />
            <Step label="+200" onPress={() => setAmount((value) => clampAmount(value + 200))} />
          </View>
        </View>

        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Стоимость</Text>
          <Text style={styles.price}>{money(price)}</Text>
        </View>
        <Button
          title="Добавить"
          size="lg"
          onPress={() => onAdd(amount)}
          disabled={amount <= 0}
          style={styles.addButton}
        />
      </ScrollView>
    </BottomSheet>
  );
}

function DialMark({ x, y, value, measure }: { x: number; y: number; value: number; measure: Dish['weightedMeasure'] }) {
  const label = amountLabel(value, measure);
  return <SvgText x={x} y={y} textAnchor="middle" fill="#60708d" fontSize="15">{`${label.value} ${label.unit}`}</SvgText>;
}

function Step({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <FastPressable disabled={disabled} onPress={onPress} style={[styles.step, disabled && styles.disabled]}>
      <Text style={styles.stepText}>{label}</Text>
    </FastPressable>
  );
}

const styles = StyleSheet.create({
  panel: { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  sheetBody: { flex: 1, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  header: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: colors.textPrimary },
  subtitle: { marginTop: spacing.sm, fontSize: 16, lineHeight: 22, color: colors.textMuted },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slate100 },
  dialRow: { marginTop: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  steps: { width: 50, gap: spacing.sm, zIndex: 2 },
  leftSteps: { paddingTop: 48 },
  rightSteps: { paddingTop: 24 },
  step: { height: 54, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white, ...softShadow },
  stepText: { fontSize: 17, fontWeight: '600', color: colors.primary },
  disabled: { opacity: 0.35 },
  dialShadow: { position: 'absolute', left: '19.5%', top: '19.5%', width: '61%', height: '61%', borderRadius: 999, backgroundColor: colors.white, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
  editHitbox: { position: 'absolute', left: '29%', top: '34%', width: '42%', height: '34%', borderRadius: radius.pill },
  amountInput: { position: 'absolute', left: '31%', top: '42%', width: '38%', height: 48, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.96)', textAlign: 'center', fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  priceRow: { minHeight: 62, marginTop: spacing.md, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white, ...softShadow },
  priceLabel: { fontSize: 13, color: colors.textMuted },
  price: { fontSize: 20, lineHeight: 24, fontWeight: '600', color: colors.textPrimary },
  addButton: { height: 56, marginTop: spacing.lg, borderRadius: radius.md },
});
