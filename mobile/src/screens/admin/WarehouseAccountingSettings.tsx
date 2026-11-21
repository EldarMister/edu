import React, { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Card, Toggle } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useWarehousePolicy, useUpdateWarehousePolicy, type WarehousePolicyInput } from '@/services/api/warehouse';
import { colors, spacing } from '@/theme';

export function WarehouseAccountingSettings() {
  const query = useWarehousePolicy();
  const mutation = useUpdateWarehousePolicy();
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  async function save(body: WarehousePolicyInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    try {
      await mutation.mutateAsync(body);
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      inFlight.current = false;
    }
  }

  const policy = query.data;
  return <Card style={styles.stack}>
    <Text style={styles.title} translate>Операции склада</Text>
    {query.isPending ? <ActivityIndicator color={colors.primary} /> : null}
    {policy ? <>
      <PolicyOption label="Производство полуфабрикатов" checked={policy.warehouseProductionEnabled || policy.productionInUse}
        inUse={policy.productionInUse} pending={mutation.isPending} onChange={(value) => void save({ warehouseProductionEnabled: value })} />
      <PolicyOption label="Переработки и разделка" checked={policy.warehouseProcessingEnabled || policy.processingInUse}
        inUse={policy.processingInUse} pending={mutation.isPending} onChange={(value) => void save({ warehouseProcessingEnabled: value })} />
      <Text style={styles.title} translate>Отрицательные остатки</Text>
      <PolicyOption label="Разрешить продажи при нехватке товара" checked={policy.allowNegativeIngredientStock}
        pending={mutation.isPending} onChange={(value) => void save({ allowNegativeIngredientStock: value })} />
      {policy.allowNegativeIngredientStock ? <Text style={styles.description} translate>
        При отрицательном остатке себестоимость будет предварительной. Оформляйте поставки вовремя.
      </Text> : null}
    </> : null}
    {error || query.isError ? <Text accessibilityRole="alert" style={styles.error}>{error || apiError(query.error)}</Text> : null}
    {query.isError ? <Button title="Повторить" size="md" variant="secondary" onPress={() => void query.refetch()} /> : null}
  </Card>;
}

function PolicyOption({ label, checked, inUse, pending, onChange }: {
  label: string; checked: boolean; inUse?: boolean; pending: boolean; onChange: (value: boolean) => void;
}) {
  return <View style={styles.option}>
    <View style={styles.copy}>
      <Text style={styles.label} translate>{label}</Text>
      {inUse ? <Text style={styles.description} translate>Раздел доступен для существующих рецептур и документов.</Text> : null}
    </View>
    <Toggle checked={checked} onChange={onChange} accessibilityLabel={label} disabled={pending || inUse} />
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  label: { color: colors.textPrimary, fontSize: 14 },
  description: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.danger },
});
