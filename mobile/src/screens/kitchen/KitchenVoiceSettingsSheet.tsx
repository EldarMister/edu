import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
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
              <Pressable
                key={speaker.value}
                onPress={() => patch({ speaker: speaker.value })}
                style={[styles.speakerRow, active && styles.speakerRowActive]}
              >
                <View style={[styles.radio, active && { borderColor: colors.primary }]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={[styles.speakerName, active && { color: colors.primary }]}>{speaker.label}</Text>
              </Pressable>
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
        <View style={styles.rateRow}>
          {KITCHEN_SPEECH_RATES.map((rate) => {
            const active = settings.speechRate === rate;
            return (
              <Pressable
                key={rate}
                onPress={() => patch({ speechRate: rate as KitchenSpeechRate })}
                style={[styles.rateChip, active && styles.rateChipActive]}
              >
                <Text style={[styles.rateText, active && styles.rateTextActive]}>{rate.toFixed(1)}x</Text>
              </Pressable>
            );
          })}
        </View>
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
  rateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rateChip: {
    minWidth: 52,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  rateChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  rateText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textMuted },
  rateTextActive: { color: colors.primary },
  testMessage: { marginTop: spacing.sm, fontSize: fontSize.xs, textAlign: 'center' },
});
