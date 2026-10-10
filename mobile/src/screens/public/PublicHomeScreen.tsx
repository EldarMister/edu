import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/components/typography';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Field } from '@/components/ui';
import type { RootStackParamList } from '@/navigation/types';
import { colors, fontSize, spacing } from '@/theme';
import { PublicLayout } from './PublicLayout';
import { parsePublicLink } from '@/navigation/publicLinks';

export function PublicHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [link, setLink] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const openMenu = () => {
    const target = parsePublicLink(link.trim());
    if (target?.screen === 'QrMenu') { setError(''); navigation.navigate('QrMenu', target.params); }
    else setError('Вставьте ссылку QR-меню стола вида /menu/…');
  };
  return <PublicLayout title="EDU POS"><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading} translate>Меню для гостей</Text><Text style={styles.muted} translate>Откройте ссылку QR-кода вашего стола.</Text><Field label="Ссылка меню" placeholder="https://…/menu/…" value={link} onChangeText={setLink} autoCapitalize="none" /><Button title="Открыть меню" onPress={openMenu} />
    <Text style={styles.heading} translate>Очередь заказов</Text><Field label="Код табло" placeholder="Введите короткий код или ссылку" value={code} onChangeText={setCode} autoCapitalize="characters" /><Button title="Открыть табло" variant="secondary" disabled={!code.trim()} onPress={() => { const target = parsePublicLink(code.trim()); navigation.navigate('Queue', target?.screen === 'Queue' ? target.params : { code: code.trim() }); }} />
    <Text style={styles.heading} translate>Панель платформы</Text><Button title="Вход супер-администратора" variant="secondary" onPress={() => navigation.navigate('Platform')} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </ScrollView></PublicLayout>;
}
const styles = StyleSheet.create({ content: { padding: spacing.lg, gap: spacing.lg }, heading: { color: colors.textPrimary, fontSize: fontSize.xl, fontWeight: '700', marginTop: spacing.md }, muted: { color: colors.textMuted, fontSize: fontSize.base }, error: { color: colors.danger } });
