import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { FastPressable } from '@/components/FastPressable';
import { Button, Card, Field } from '@/components/ui';
import { BrandLogo } from '@/components/BrandLogo';
import { colors, fontSize, spacing } from '@/theme';
import { useLogin } from '@/services/api/auth';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { reconnectSocket } from '@/services/socket';

export function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const setSession = useAuth((s) => s.setSession);

  const onSubmit = () => {
    if (login.isPending) return;
    setError(null);
    if (!phone.trim() || password.length < 1) {
      setError('Введите номер телефона и пароль');
      return;
    }
    login.mutate(
      { phone: phone.trim(), password },
      {
        onSuccess: (data) => {
          setSession(data);
          reconnectSocket();
        },
        onError: (e) => setError(apiError(e)),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <BrandLogo size="login" />
            <Text style={styles.subtitle} translate>Система управления рестораном</Text>
          </View>

          <Card style={styles.cardForm}>
            <View style={styles.cardHead}>
              <Text style={styles.title} translate>Вход в систему</Text>
              <Text style={styles.cardSub} translate>Введите номер телефона и пароль для входа в систему</Text>
            </View>

            <Field
              label="Номер телефона"
              placeholder="Введите номер телефона"
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="username"
              value={phone}
              onChangeText={setPhone}
            />
            <Field
              label="Пароль"
              placeholder="Введите пароль"
              secureTextEntry={!showPassword}
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
              rightSlot={
                <FastPressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'} onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textLight}
                  />
                </FastPressable>
              }
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button title="Войти" onPress={onSubmit} loading={login.isPending} fontWeight="600" />
          </Card>

          <Text style={styles.version}>v{Constants.expoConfig?.version ?? '0.1.1'}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  brand: { alignItems: 'center', gap: 4, marginBottom: 32 },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  cardForm: { width: '100%', maxWidth: 400, padding: 28, gap: spacing.lg },
  cardHead: { alignItems: 'center', gap: 6, marginBottom: 8 },
  title: { fontSize: fontSize.xl, fontWeight: '600', color: colors.textPrimary },
  cardSub: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', maxWidth: 260 },
  error: { color: colors.danger, fontSize: fontSize.sm },
  version: { textAlign: 'center', fontSize: fontSize.xs, color: colors.textLight, marginTop: 24 },
});
