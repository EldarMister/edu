import { Linking, Platform, StyleSheet } from 'react-native';
import { PRIVACY_POLICY_URL } from '@/config/env';
import { colors, fontSize } from '@/theme';
import { FastPressable } from './FastPressable';
import { Alert, Text } from './typography';

const privacyLabel = 'Политика конфиденциальности';

export function PrivacyPolicyLink() {
  if (Platform.OS !== 'ios') return null;

  const open = () => {
    void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
      Alert.alert(privacyLabel, 'Не удалось открыть страницу. Проверьте подключение к интернету.');
    });
  };

  return (
    <FastPressable accessibilityRole="link" onPress={open} style={styles.link}>
      <Text style={styles.label} translate>{privacyLabel}</Text>
    </FastPressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', justifyContent: 'center', minHeight: 44 },
  label: { color: colors.primary, fontSize: fontSize.sm, textAlign: 'center' },
});
