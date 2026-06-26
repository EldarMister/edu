import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing, fontSize, cardShadow, waiterLayout } from '@/theme';
import { PwaIcon } from './PwaIcon';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'lg' | 'md';

/** Кнопка — повторяет .btn-primary/.btn-secondary/.btn-danger + btn-lg/btn-md из PWA. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading,
  disabled,
  danger,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Вторичная кнопка с красным текстом (как «Выйти»). */
  danger?: boolean;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  const height = size === 'lg' ? 48 : 40;
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.white;
  const fg =
    variant === 'secondary' ? (danger ? colors.danger : colors.textPrimary) : colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.btn,
        { height, backgroundColor: bg, opacity: isDisabled ? 0.5 : 1 },
        variant === 'secondary' && styles.btnSecondary,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text
          style={[
            styles.btnText,
            { color: fg, fontSize: size === 'lg' ? fontSize.base : fontSize.sm },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Карточка — .card: bg-white rounded-2xl border border-border shadow-card. */
export function Card({
  children,
  style,
  onPress,
  highlighted,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  /** Подсветка как у заказов «требующих внимания» (border-primary/40 bg-primary/5). */
  highlighted?: boolean;
}) {
  const content = [
    styles.card,
    highlighted && { borderColor: 'rgba(0,91,255,0.4)', backgroundColor: colors.primaryFaint },
    style,
  ];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={content}>
        {children}
      </Pressable>
    );
  }
  return <View style={content}>{children}</View>;
}

/** Поле ввода — .input: h-11 rounded-xl border. С опциональной меткой PWA. */
export function Field({
  label,
  error,
  rightSlot,
  containerStyle,
  ...props
}: TextInputProps & {
  label?: string;
  error?: string;
  rightSlot?: React.ReactNode;
  containerStyle?: ViewStyle;
}) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <TextInput
          placeholderTextColor={colors.textLight}
          style={[
            styles.input,
            focused && { borderColor: colors.primary },
            error ? { borderColor: colors.danger } : null,
            rightSlot ? { paddingRight: 44 } : null,
          ]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {rightSlot ? <View style={styles.inputRight}>{rightSlot}</View> : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function Loading({ text }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {text ? <Text style={styles.muted}>{text}</Text> : null}
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

/** Горизонтальные «пилюли»-табы (залы, категории) — bg-primary активный. */
export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  style,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.pillOuter, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        {items.map((it) => {
          const active = it.key === value;
          return (
            <Pressable key={it.key} onPress={() => onChange(it.key)} style={[styles.pill, active && styles.pillActive]}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{it.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Сегмент-табы кухни (rounded-lg, активный bg-primary, со счётчиком). */
export function SegmentTabs<T extends string>({
  items,
  value,
  onChange,
  count,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  count?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.segmentRow}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{it.label}</Text>
            {active && count != null && count > 0 ? (
              <View style={styles.segmentCount}>
                <Text style={styles.segmentCountText}>{count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Круглая кнопка ±, как в корзине PWA (dec красная, inc синяя). */
export function RoundBtn({ kind, onPress }: { kind: 'inc' | 'dec'; onPress: () => void }) {
  const isDec = kind === 'dec';
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.roundBtn,
        { borderColor: isDec ? colors.red400 : colors.primary },
      ]}
    >
      <PwaIcon name={isDec ? 'minus' : 'plus'} size={14} color={isDec ? colors.red500 : colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btnSecondary: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontWeight: '600' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...cardShadow,
  },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '500' },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  inputRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: fontSize.sm, color: colors.danger },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  muted: { color: colors.textMuted, fontSize: fontSize.base, textAlign: 'center' },

  pillOuter: { height: waiterLayout.pillHeight, flexGrow: 0, flexShrink: 0 },
  pillRow: { gap: spacing.sm },
  pill: {
    height: waiterLayout.pillHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: waiterLayout.pillRadius,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: fontSize.tab, color: colors.textSecondary, fontWeight: '500' },
  pillTextActive: { color: colors.white },

  segmentRow: { gap: spacing.sm, paddingVertical: 2 },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: fontSize.base, color: colors.textSecondary, fontWeight: '500' },
  segmentTextActive: { color: colors.white },
  segmentCount: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  segmentCountText: { color: colors.white, fontSize: fontSize.xs },

  roundBtn: {
    width: waiterLayout.roundButton,
    height: waiterLayout.roundButton,
    borderRadius: waiterLayout.roundButton / 2,
    borderWidth: 1,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
