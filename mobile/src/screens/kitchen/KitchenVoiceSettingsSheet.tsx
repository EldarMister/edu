import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button, Toggle } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { kitchenVoice } from '@/services/kitchenVoice';
import {
  KITCHEN_SPEAKERS,
  KITCHEN_SPEECH_RATES,
  KITCHEN_VOICE_TEST_SCENARIOS,
  getKitchenVoiceSettings,
  useKitchenVoiceSettings,
  type KitchenSpeechRate,
} from '@/services/kitchenVoiceSettings';

/** Настройки озвучки кухни — как PWA KitchenVoiceSettings (попап → нижний лист). */
export function KitchenVoiceSettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const settings = useKitchenVoiceSettings();
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');

  const patch = (next: Parameters<typeof settings.patch>[0]) => {
    settings.patch(next);
    setTestMessage('');
  };

  const testVoice = async () => {
    setTesting(true);
    setTestMessage('');
    const scenario =
      KITCHEN_VOICE_TEST_SCENARIOS[Math.floor(Math.random() * KITCHEN_VOICE_TEST_SCENARIOS.length)];
    try {
      await kitchenVoice.testScenario(scenario, getKitchenVoiceSettings());
      setTestMessage('Тест озвучки завершён');
    } catch (err) {
      console.error('[kitchen-tts] тест озвучки не удался:', err);
      setTestMessage('Не удалось воспроизвести тест');
    } finally {
      setTesting(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Настройки озвучки кухни" maxHeight="88%">
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Голос</Text>
        <View style={styles.speakerList}>
          {KITCHEN_SPEAKERS.map((speaker) => {
            const active = settings.speaker === speaker.value;
            return (
              <FastPressable
                key={speaker.value}
                onPress={() => patch({ speaker: speaker.value })}
                style={[styles.speakerRow, active && styles.speakerRowActive]}
              >
                <View style={[styles.radio, active && { borderColor: colors.primary }]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={[styles.speakerName, active && { color: colors.primary }]}>{speaker.label}</Text>
              </FastPressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Уведомления</Text>
          <Toggle
            checked={settings.notificationsEnabled}
            onChange={(value) => patch({ notificationsEnabled: value })}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Голосовая озвучка</Text>
          <Toggle checked={settings.voiceEnabled} onChange={(value) => patch({ voiceEnabled: value })} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Скорость озвучки</Text>
        <SpeedSlider
          rates={KITCHEN_SPEECH_RATES}
          value={settings.speechRate}
          onChange={(rate) => patch({ speechRate: rate })}
        />
      </View>

      <View style={[styles.section, { paddingBottom: spacing.md }]}>
        <Button title={testing ? 'Тестируем...' : 'Тестировать'} loading={testing} onPress={() => void testVoice()} />
        {testMessage ? (
          <Text
            style={[
              styles.testMessage,
              { color: testMessage.includes('Не удалось') ? colors.danger : colors.success },
            ]}
          >
            {testMessage}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

/** Дискретный ползунок скорости — паритет с PWA SpeedSlider: дорожка с заливкой,
 *  точки-остановки, круглый ползунок и подписи; тап и перетаскивание по дорожке. */
function SpeedSlider({
  rates,
  value,
  onChange,
}: {
  rates: KitchenSpeechRate[];
  value: KitchenSpeechRate;
  onChange: (rate: KitchenSpeechRate) => void;
}) {
  const n = rates.length;
  const index = Math.max(0, rates.indexOf(value));
  const posOf = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const pct = posOf(index);

  const trackRef = useRef<View>(null);
  const widthRef = useRef(0);
  const pageXRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const ratesRef = useRef(rates);
  ratesRef.current = rates;

  const setFromX = (absX: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const rts = ratesRef.current;
    const ratio = Math.min(1, Math.max(0, (absX - pageXRef.current) / w));
    const next = rts[Math.round(ratio * (rts.length - 1))];
    if (next !== valueRef.current) onChangeRef.current(next);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const pageX = e.nativeEvent.pageX;
        trackRef.current?.measureInWindow((x, _y, w) => {
          pageXRef.current = x;
          if (w > 0) widthRef.current = w;
          setFromX(pageX);
        });
      },
      onPanResponderMove: (e) => setFromX(e.nativeEvent.pageX),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
  };

  return (
    <View style={styles.sliderWrap}>
      <View ref={trackRef} onLayout={onLayout} style={styles.sliderTrack} {...pan.panHandlers}>
        <View style={styles.sliderRail} />
        <View style={[styles.sliderFill, { width: `${pct}%` }]} />
        {rates.map((r, i) => (
          <View
            key={r}
            style={[
              styles.sliderDot,
              { left: `${posOf(i)}%` },
              i <= index ? styles.sliderDotOn : styles.sliderDotOff,
            ]}
          />
        ))}
        <View style={[styles.sliderThumb, { left: `${pct}%` }]} />
      </View>
      <View style={styles.sliderLabels}>
        {rates.map((r, i) => {
          const active = r === value;
          return (
            <FastPressable
              key={r}
              onPress={() => onChange(r)}
              style={[styles.sliderLabelHit, { left: `${posOf(i)}%` }]}
            >
              <Text style={[styles.sliderLabel, active && styles.sliderLabelActive]}>{r.toFixed(1)}x</Text>
            </FastPressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.md },
  sectionTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  speakerList: { gap: 4 },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  speakerRowActive: { backgroundColor: colors.primarySoft },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.slate300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  speakerName: { fontSize: fontSize.base, fontWeight: '500', color: colors.textSecondary },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingLabel: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  sliderWrap: { paddingHorizontal: 10 },
  sliderTrack: { height: 28, justifyContent: 'center' },
  sliderRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 11,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  sliderFill: { position: 'absolute', left: 0, top: 11, height: 6, borderRadius: 999, backgroundColor: colors.primary },
  sliderDot: { position: 'absolute', top: 10, width: 8, height: 8, marginLeft: -4, borderRadius: 4 },
  sliderDotOn: { backgroundColor: colors.primary },
  sliderDotOff: { backgroundColor: colors.slate300 },
  sliderThumb: {
    position: 'absolute',
    top: 4,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  sliderLabels: { position: 'relative', marginTop: spacing.sm, height: 18 },
  sliderLabelHit: { position: 'absolute', width: 40, marginLeft: -20, alignItems: 'center', paddingVertical: 1 },
  sliderLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted },
  sliderLabelActive: { color: colors.primary },
  testMessage: { marginTop: spacing.sm, fontSize: fontSize.xs, textAlign: 'center' },
});
