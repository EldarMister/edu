import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui';
import { Text } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { ORDER_PERMISSION_STAGES, type WaiterOrderPermissions } from '@/lib/order-permissions';
import { colors } from '@/theme';

export function OrderPermissionsSettings({ permissions, disabled, onPermissions }: {
  permissions: WaiterOrderPermissions; disabled?: boolean;
  onPermissions: (permissions: WaiterOrderPermissions) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return <Card style={styles.card}>
    <FastPressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.heading}>
      <Text style={styles.title} translate>Заказы</Text>
      <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><PwaIcon name="chevronDown" size={20} color={colors.textMuted} /></View>
    </FastPressable>
    {open ? <View style={styles.body}>
      <Text style={styles.subtitle} translate>Права официантов</Text>
      <Text style={styles.help} translate>Правила применяются к каждой позиции отдельно. Удаление, замена и уменьшение количества требуют разрешения на отмену.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={styles.row}><Text style={[styles.stage, styles.header]} translate>Этап блюда / заказа</Text><Text style={[styles.cancel, styles.header]} translate>Отмена</Text><Text style={[styles.edit, styles.header]} translate>Редактирование</Text></View>
          {ORDER_PERMISSION_STAGES.map(([stage, label]) => <View key={stage} style={styles.row}>
            <Text style={styles.stage} translate>{label}</Text>
            {(['cancel', 'edit'] as const).map(action => <View key={action} style={action === 'cancel' ? styles.cancel : styles.edit}>
              <FastPressable accessibilityRole="checkbox" accessibilityLabel={`${action === 'cancel' ? 'Отмена' : 'Редактирование'}: ${label}`}
                accessibilityState={{ checked: permissions[stage][action], disabled: !!disabled }} disabled={disabled}
                onPress={() => onPermissions({ ...permissions, [stage]: { ...permissions[stage], [action]: !permissions[stage][action] } })}
                hitSlop={10} style={[styles.checkbox, permissions[stage][action] && styles.checked, disabled && { opacity: 0.5 }]}>
                {permissions[stage][action] ? <PwaIcon name="check" size={16} color={colors.white} /> : null}
              </FastPressable>
            </View>)}
          </View>)}
        </View>
      </ScrollView>
      <Text style={styles.footnote} translate>Оплаченные позиции и закрытые чеки обрабатываются через права на отмену оплаты / возврат. Эти правила не разрешают менять оплату.</Text>
    </View> : null}
  </Card>;
}

const styles = StyleSheet.create({
  card: { padding: 20, borderRadius: 16 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  title: { fontSize: 18, fontWeight: '600', color: colors.textPrimary }, subtitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  body: { marginTop: 20, gap: 16 }, help: { fontSize: 14, color: colors.textMuted, lineHeight: 20 }, footnote: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1, borderColor: colors.border },
  stage: { width: 175, paddingRight: 12, color: colors.textPrimary, fontSize: 14 }, cancel: { width: 85, paddingHorizontal: 12 }, edit: { width: 145, paddingHorizontal: 12 },
  header: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' }, checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: colors.textMuted, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
});
