import React from 'react';
import { Keyboard, Modal, Platform, ScrollView, StyleSheet, View, useWindowDimensions, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text, TextInput } from '@/components/typography';
import { useT } from '@/lib/i18n';
import { colors } from '@/theme';
import { calendarCells, calendarMonth, dateToIso, displayDate, isAllowedDate, parseDisplayDate, shiftCalendarMonth } from '@/utils/calendarDate';
import { FastPressable } from './FastPressable';
import { PwaIcon } from './PwaIcon';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  error?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  containerStyle?: ViewStyle;
  openOnMount?: boolean;
};
type Anchor = { x: number; y: number; width: number; height: number };
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** The PWA calendar, anchored to its field. Public values remain local ISO dates. */
export function DateField({
  value, onChangeText, minimumDate, maximumDate, label, error, containerStyle,
  openOnMount = false, style, editable = true, readOnly = false, placeholder,
  accessibilityLabel, onFocus, onBlur, maxLength, ...inputProps
}: Props) {
  const tr = useT();
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const canEdit = editable && !readOnly;
  const minimum = minimumDate ? dateToIso(minimumDate) : '';
  const maximum = maximumDate ? dateToIso(maximumDate) : '';
  const [open, setOpen] = React.useState(openOnMount && canEdit);
  const [focused, setFocused] = React.useState(false);
  const [typedDate, setTypedDate] = React.useState(() => displayDate(value));
  const [month, setMonth] = React.useState(() => calendarMonth(value || minimum || maximum));
  const [anchor, setAnchor] = React.useState<Anchor | null>(null);
  const [viewport, setViewport] = React.useState({ width: dimensions.width, height: dimensions.height });
  const [contentHeight, setContentHeight] = React.useState(340);
  const anchorRef = React.useRef<View>(null);
  const inputRef = React.useRef<TextInput>(null);
  const mountedRef = React.useRef(true);
  const openedRef = React.useRef(open);
  openedRef.current = open;
  const cells = React.useMemo(() => calendarCells(month), [month]);
  const today = dateToIso(new Date());
  const todayAllowed = isAllowedDate(today, minimum, maximum);
  const fieldLabel = accessibilityLabel ?? (label ? `${tr('Выбрать дату')}: ${tr(label)}` : tr('Выбрать дату'));

  const measureAnchor = React.useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      if (mountedRef.current && openedRef.current && width > 0 && height > 0) setAnchor({ x, y, width, height });
    });
  }, []);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  React.useEffect(() => { setTypedDate(displayDate(value)); }, [value]);
  React.useEffect(() => { if (!canEdit) setOpen(false); }, [canEdit]);
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(measureAnchor);
    const shown = Keyboard.addListener('keyboardDidShow', measureAnchor);
    const hidden = Keyboard.addListener('keyboardDidHide', measureAnchor);
    return () => { cancelAnimationFrame(frame); shown.remove(); hidden.remove(); };
  }, [open, measureAnchor, dimensions.width, dimensions.height]);

  const close = () => setOpen(false);
  const show = () => {
    if (!canEdit) return;
    inputRef.current?.blur();
    Keyboard.dismiss();
    setMonth(calendarMonth(value || minimum || maximum));
    setAnchor(null);
    setOpen(true);
  };
  const choose = (next: string) => {
    if (next && !isAllowedDate(next, minimum, maximum)) return;
    setTypedDate(displayDate(next));
    onChangeText(next);
    close();
  };
  const typeDate = (text: string) => {
    // Numeric keyboards do not all expose a dot; insert the display separators.
    const digits = text.replace(/\D/g, '').slice(0, 8);
    const next = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.');
    setTypedDate(next);
    if (!next) { onChangeText(''); return; }
    const parsed = parseDisplayDate(next);
    if (parsed) {
      const iso = dateToIso(parsed);
      if (isAllowedDate(iso, minimum, maximum)) {
        onChangeText(iso);
        setMonth(calendarMonth(iso));
      }
    }
  };

  // Android's non-translucent Modal shares the field's visible-window origin.
  // On iOS, the dialog also avoids the notch and the home indicator.
  const edgeTop = 8 + (Platform.OS === 'ios' ? insets.top : 0);
  const edgeBottom = 8 + (Platform.OS === 'ios' ? insets.bottom : 0);
  const leftEdge = 8 + insets.left;
  const rightEdge = 8 + insets.right;
  const popupWidth = Math.max(1, Math.min(316, viewport.width - leftEdge - rightEdge));
  const maxHeight = Math.max(1, viewport.height - edgeTop - edgeBottom);
  const popupHeight = Math.min(contentHeight, maxHeight);
  const below = anchor ? viewport.height - edgeBottom - anchor.y - anchor.height : 0;
  const desiredTop = anchor ? below >= popupHeight + 7 ? anchor.y + anchor.height + 7 : anchor.y - popupHeight - 7 : edgeTop;
  const top = Math.max(edgeTop, Math.min(desiredTop, viewport.height - edgeBottom - popupHeight));
  const left = Math.max(leftEdge, Math.min((anchor?.x ?? leftEdge) + (anchor?.width ?? popupWidth) - popupWidth, viewport.width - rightEdge - popupWidth));
  const displayPlaceholder = !placeholder || /^(?:YYYY-MM-DD|ГГГГ-ММ-ДД)$/i.test(placeholder) ? 'ДД.ММ.ГГГГ' : placeholder;
  const resolvedStyle = StyleSheet.flatten(style) ?? {};
  const fieldHeight = resolvedStyle.height ?? 46;

  return <>
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label} translate>{label}</Text> : null}
      <View ref={anchorRef} collapsable={false} onLayout={() => { if (open) measureAnchor(); }}
        style={[styles.field, { height: fieldHeight }, (focused || open) && styles.fieldFocused, error ? styles.fieldError : null,
          resolvedStyle.borderColor && { borderColor: focused || open ? '#397EFF' : resolvedStyle.borderColor },
          resolvedStyle.borderRadius != null && { borderRadius: resolvedStyle.borderRadius }]}>
        {(focused || open) && !error ? <View pointerEvents="none" style={styles.focusRing} /> : null}
        <TextInput {...inputProps} ref={inputRef} editable={canEdit} readOnly={readOnly}
          value={typedDate} onChangeText={typeDate} maxLength={maxLength ?? 10}
          keyboardType={inputProps.keyboardType ?? 'number-pad'} autoCapitalize="none"
          autoCorrect={false} placeholder={displayPlaceholder} placeholderTextColor="#93A3BE"
          accessibilityLabel={fieldLabel} accessibilityHint="Формат даты: ДД.ММ.ГГГГ"
          style={[styles.input, style, { flex: 1, height: '100%', borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent' }]}
          onFocus={event => { setFocused(true); onFocus?.(event); }}
          onBlur={event => { setFocused(false); setTypedDate(displayDate(value)); onBlur?.(event); }} />
        <FastPressable style={styles.icon} onPress={() => open ? close() : show()} disabled={!canEdit}
          accessibilityRole="button" accessibilityLabel={fieldLabel} accessibilityState={{ disabled: !canEdit, expanded: open }}>
          <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#324A76" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={canEdit ? 1 : 0.5}>
            <Rect x={3} y={5} width={18} height={16} rx={2} /><Path d="M7 3v4M17 3v4M3 10h18" />
          </Svg>
        </FastPressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
    <Modal visible={open && canEdit} transparent animationType="none" hardwareAccelerated onRequestClose={close} onShow={measureAnchor}>
      <View style={styles.modalRoot} accessibilityViewIsModal onAccessibilityEscape={close}
        onLayout={event => { const { width, height } = event.nativeEvent.layout; setViewport({ width, height }); measureAnchor(); }}>
        <FastPressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Закрыть календарь" />
        {anchor ? <View style={[styles.calendar, { top, left, width: popupWidth, height: popupHeight }]} accessibilityLabel={fieldLabel}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.calendarContent} showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always" bounces={false}
            onContentSizeChange={(_width, height) => { if (height > 0) setContentHeight(current => Math.abs(current - height) > 0.5 ? height : current); }}>
            <View style={styles.header}>
              <Text style={styles.month} accessibilityRole="header" accessibilityLiveRegion="polite" numberOfLines={1}>{tr(MONTHS[month.getMonth()])} {month.getFullYear()} г.</Text>
              <View style={styles.navigation}>
                <FastPressable style={styles.arrow} accessibilityRole="button" accessibilityLabel="Предыдущий месяц"
                  disabled={month.getFullYear() === 1 && month.getMonth() === 0} onPress={() => setMonth(current => shiftCalendarMonth(current, -1))}>
                  <PwaIcon name="chevronLeft" size={17} color="#466087" />
                </FastPressable>
                <FastPressable style={styles.arrow} accessibilityRole="button" accessibilityLabel="Следующий месяц"
                  disabled={month.getFullYear() === 9999 && month.getMonth() === 11} onPress={() => setMonth(current => shiftCalendarMonth(current, 1))}>
                  <PwaIcon name="chevronRight" size={17} color="#466087" />
                </FastPressable>
              </View>
            </View>
            <View style={styles.grid}>
              <View style={styles.week}>
                {WEEKDAYS.map(day => <View key={day} style={styles.weekday}><Text style={styles.weekdayText} translate>{day}</Text></View>)}
              </View>
              {Array.from({ length: cells.length / 7 }, (_, week) => <View key={week} style={styles.week}>
              {cells.slice(week * 7, week * 7 + 7).map((cell, index) => {
                const allowed = isAllowedDate(cell.iso, minimum, maximum);
                const selected = !!cell.iso && value === cell.iso;
                const isToday = today === cell.iso;
                return <FastPressable key={`${cell.iso}-${index}`} disabled={!allowed} onPress={() => choose(cell.iso)}
                  accessibilityRole="button" accessibilityLabel={displayDate(cell.iso)} accessibilityState={{ selected, disabled: !allowed }}
                  style={[styles.day, isToday && !selected && allowed && styles.dayToday, selected && styles.daySelected,
                    !allowed && styles.dayDisabled]}>
                  <Text style={[styles.dayText, cell.outside && styles.outsideText, selected && styles.selectedText, !allowed && styles.disabledText]}>{cell.date.getDate()}</Text>
                </FastPressable>;
              })}
              </View>)}
            </View>
            <View style={styles.footer}>
              <FastPressable onPress={() => choose('')} accessibilityRole="button" style={styles.footerButton}><Text style={styles.footerText} translate>Очистить</Text></FastPressable>
              <FastPressable onPress={() => choose(today)} disabled={!todayAllowed} accessibilityRole="button"
                accessibilityState={{ disabled: !todayAllowed }} style={styles.footerButton}>
                <Text style={[styles.footerText, !todayAllowed && styles.disabledText]} translate>Сегодня</Text>
              </FastPressable>
            </View>
          </ScrollView>
        </View> : null}
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  container: { gap: 6, minWidth: 0 },
  label: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#DCE5F2', borderRadius: 11, backgroundColor: colors.white, paddingLeft: 13 },
  fieldFocused: { borderColor: '#397EFF' },
  fieldError: { borderColor: colors.danger },
  focusRing: { ...StyleSheet.absoluteFillObject, top: -4, bottom: -4, left: -4, right: -4, borderWidth: 3, borderRadius: 14, borderColor: 'rgba(0,91,255,0.11)' },
  input: { minWidth: 0, fontSize: 16, lineHeight: 22, color: '#1F3156' },
  icon: { width: 37, height: '100%', alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 14, color: colors.danger },
  modalRoot: { flex: 1 },
  calendar: { position: 'absolute', backgroundColor: colors.white, borderWidth: 1, borderColor: '#E1E8F3', borderRadius: 13,
    shadowColor: '#1D365E', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.14, shadowRadius: 17, elevation: 10 },
  calendarContent: { paddingTop: 15, paddingHorizontal: 16, paddingBottom: 11 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 4 },
  month: { fontSize: 14, fontWeight: '700', color: '#172440', flexShrink: 1 },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  arrow: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  grid: { gap: 2 },
  week: { flexDirection: 'row', gap: 2 },
  weekday: { flex: 1, height: 27, alignItems: 'center', justifyContent: 'center' },
  weekdayText: { color: '#6E7E9A', fontSize: 11, lineHeight: 16 },
  day: { flex: 1, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dayText: { color: '#1C2A48', fontSize: 14, lineHeight: 20 },
  dayToday: { borderWidth: 1, borderColor: '#A7C6FF' },
  daySelected: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  dayDisabled: { shadowOpacity: 0, elevation: 0 },
  outsideText: { color: '#A4B0C2' },
  selectedText: { color: colors.white },
  disabledText: { color: '#B8C2D2' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#EDF1F7' },
  footerButton: { paddingVertical: 5, paddingHorizontal: 2 },
  footerText: { color: colors.primary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
