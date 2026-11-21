import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { Button } from '@/components/ui';
import { apiError } from '@/lib/api';
import type { WarehouseView } from '@/navigation/adminWorkspaceNavigation';
import { useWarehouseLocations } from '@/services/api/warehouse';
import { colors, spacing } from '@/theme';
import { WarehouseLocationsPage } from './WarehouseLocationsSheet';
import { WarehouseDocumentsTab } from './WarehouseDocumentsTab';
import { WarehouseMovementReport } from './WarehouseMovementReport';
import { WarehouseTransfersTab } from './WarehouseTransfersTab';
import { WarehouseSuppliersTab, WarehousePackagesTab } from './WarehouseDirectories';
import { WarehouseBalances } from './WarehouseBalances';
import { WarehouseProductionTab } from './WarehouseProductionTab';
import { WarehouseProcessingTab } from './WarehouseProcessingTab';
import { WarehouseSuppliesTab } from './WarehouseSuppliesTab';

export function WarehouseScreen({ view = 'balances' }: { view?: WarehouseView }) {
  return <AnchoredSelectScope><WarehouseContent view={view} /></AnchoredSelectScope>;
}

function WarehouseContent({ view }: { view: WarehouseView }) {
  const [warehousesByView, setWarehousesByView] = useState<Partial<Record<WarehouseView, string>>>({});
  const locationsQuery = useWarehouseLocations();
  const locations = locationsQuery.data?.locations ?? [];
  const commonWarehouse = locations.find((location) => location.isDefault) ?? locations[0];
  const currentWarehouse = locations.find((location) => location.id === warehousesByView[view]);
  const selectedWarehouse = view === 'production' ? currentWarehouse ?? commonWarehouse : currentWarehouse;
  const warehouseId = selectedWarehouse?.id;
  const locationName = (id?: string | null) => locations.find((location) => location.id === id)?.name ?? commonWarehouse?.name ?? '—';
  const setWarehouse = (id: string) => setWarehousesByView((values) => ({ ...values, [view]: id }));
  const warehouseFilter = locations.length > 1 ? (
    <Select title="Склад" value={warehouseId ?? ''} options={[
      ...(view === 'production' ? [] : [{ value: '', label: 'Склад' }]),
      ...locations.map((location) => ({ value: location.id, label: location.name, translate: false })),
    ]} onChange={setWarehouse} style={view === 'balances' || view === 'supplies' ? styles.compactFilter : undefined} />
  ) : null;

  switch (view) {
    case 'suppliers': return <Surface key={view}><WarehouseSuppliersTab /></Surface>;
    case 'packages': return <Surface key={view}><WarehousePackagesTab /></Surface>;
  }
  if (locationsQuery.isPending) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!locationsQuery.data) return <View style={styles.center}>
    <Text accessibilityRole="alert" style={styles.error}>{apiError(locationsQuery.error)}</Text>
    <Button title="Повторить" variant="secondary" onPress={() => void locationsQuery.refetch()} />
  </View>;

  let content;
  switch (view) {
    case 'locations': content = <WarehouseLocationsPage data={locationsQuery.data} />; break;
    case 'balances': content = <WarehouseBalances warehouseId={warehouseId} warehouseFilter={warehouseFilter} locations={locations}
      onResetWarehouse={() => setWarehouse('')} />; break;
    case 'supplies': content = <WarehouseSuppliesTab warehouseId={warehouseId} warehouseFilter={warehouseFilter}
      defaultWarehouse={currentWarehouse ?? commonWarehouse} locationName={locationName} onResetWarehouse={() => setWarehouse('')} />; break;
    case 'transfers': content = <WarehouseTransfersTab warehouseId={warehouseId} locations={locations}
      warehouseFilter={warehouseFilter} onResetWarehouse={() => setWarehouse('')} />; break;
    case 'processing': content = <WarehouseProcessingTab warehouseId={warehouseId} locations={locations}
      warehouseFilter={warehouseFilter} onResetWarehouse={() => setWarehouse('')} />; break;
    case 'production': content = <WarehouseProductionTab warehouseId={warehouseId} warehouseFilter={warehouseFilter} locations={locations} />; break;
    case 'writeoffs':
    case 'inventory':
      content = <WarehouseDocumentsTab key={view} kind={view === 'inventory' ? 'inventory' : 'writeoff'} warehouseId={warehouseId} locations={locations}
        warehouseFilter={warehouseFilter} onResetWarehouse={() => setWarehouse('')} />;
      break;
    case 'movement': content = <WarehouseMovementReport locations={locations} />; break;
  }

  return <Surface key={view}>{content}</Surface>;
}

function Surface({ children }: React.PropsWithChildren) {
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    {children}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  compactFilter: { height: 36, borderRadius: 6, paddingHorizontal: 9 },
  center: { minHeight: 140, alignItems: 'center', justifyContent: 'center', padding: spacing.md, gap: spacing.sm },
  error: { color: colors.danger },
});
