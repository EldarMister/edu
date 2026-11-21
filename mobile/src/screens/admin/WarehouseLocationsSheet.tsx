import React, { useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Select } from '@/components/Select';
import { ScrollView, View } from '@/components/themed';
import { Alert, Text } from '@/components/typography';
import { Button, Card, EmptyState, Field } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useWarehouseLocationMutations, type WarehouseLocation, type WarehouseLocations } from '@/services/api/warehouse';
import { colors, radius, spacing } from '@/theme';
import { WarehouseWorkspace } from './WarehouseWorkspace';
import {
  WarehouseDirectoryField, WarehouseDirectoryLink, WarehouseDirectorySearch, WarehouseDirectorySection,
  WarehouseDirectorySort, WarehouseDirectoryTable, WarehouseDirectoryValue, type DirectoryColumn,
} from './WarehouseDirectoryTable';

export { WarehouseTransferSheet } from './WarehouseTransferForm';

export function WarehouseLocationsPage({ data }: { data: WarehouseLocations }) {
  const { route } = useWarehouseLocationMutations();
  const { canAction } = usePermissions();
  const editable = canAction('warehouseSettings');
  const wide = useWindowDimensions().width >= 640;
  const [editing, setEditing] = useState<WarehouseLocation | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [ascending, setAscending] = useState(true);
  const [showRoutes, setShowRoutes] = useState(false);
  const [error, setError] = useState('');
  const options = [
    { value: '', label: 'Склад по умолчанию' },
    ...data.locations.map((location) => ({ value: location.id, label: location.name, translate: false })),
  ];
  const searchText = search.trim().toLocaleLowerCase();
  const rows = data.locations
    .filter((location) => [location.name, location.address].some((value) => value?.toLocaleLowerCase().includes(searchText)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') * (ascending ? 1 : -1));

  async function changeRoute(stationId: string, warehouseId: string) {
    if (!editable || route.isPending) return;
    setError('');
    try {
      await route.mutateAsync({ stationId, warehouseId: warehouseId || null });
    } catch (cause) {
      setError(apiError(cause));
    }
  }

  const columns: DirectoryColumn<WarehouseLocation>[] = [
    { key: 'number', title: '№', width: 68,
      cell: (location) => <WarehouseDirectoryValue>{data.locations.indexOf(location) + 1}</WarehouseDirectoryValue> },
    { key: 'name', title: <WarehouseDirectorySort ascending={ascending} onToggle={() => setAscending(!ascending)} />, width: 215,
      cell: (location) => <View style={styles.nameCell}>
        {editable ? <WarehouseDirectoryLink label={location.name} onPress={() => setEditing(location)} />
          : <WarehouseDirectoryValue>{location.name}</WarehouseDirectoryValue>}
        {location.isDefault ? <Text style={styles.muted} translate>По умолчанию</Text> : null}
      </View> },
    { key: 'address', title: 'Адрес', width: 202, cell: (location) => <WarehouseDirectoryValue>{location.address || '—'}</WarehouseDirectoryValue> },
    { key: 'actions', width: 95, cell: (location) => editable ? <WarehouseDirectoryLink label="Ред." translate
      accessibilityLabel={`Редактировать: ${location.name}`} onPress={() => setEditing(location)} /> : null },
  ];

  return <View style={styles.surface}>
    <View style={[styles.content, styles.toolbar]}>
      <View style={styles.search}><WarehouseDirectorySearch label="Поиск склада" value={search} onChange={setSearch} /></View>
      {editable ? <Button title="Добавить" size="md" onPress={() => setEditing('new')} /> : null}
    </View>
    <WarehouseDirectoryTable rows={rows} columns={columns} />
    {rows.length === 0 ? <EmptyState text="Склады не найдены" /> : null}
    {data.stationRoutes.length > 0 ? <View style={styles.content}>
      <WarehouseDirectorySection label="Склады для цехов" expanded={showRoutes} onPress={() => setShowRoutes(!showRoutes)} />
      {showRoutes && data.stationRoutes.map((station) => <WarehouseDirectoryField key={station.stationId} wide={wide}
        label={station.stationName} translate={false}>
        <Select title={`Склад станции ${station.stationName}`} value={station.warehouseId ?? ''} options={options}
          disabled={!editable || route.isPending} onChange={(value) => void changeRoute(station.stationId, value)} />
      </WarehouseDirectoryField>)}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View> : null}
    {editable && editing ? <LocationEditor location={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
  </View>;
}

function LocationEditor({ location, onClose }: { location?: WarehouseLocation; onClose: () => void }) {
  const { save } = useWarehouseLocationMutations();
  const wide = useWindowDimensions().width >= 640;
  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [error, setError] = useState('');
  const saving = React.useRef(false);
  const dirty = name !== (location?.name ?? '') || address !== (location?.address ?? '');
  function close() {
    if (saving.current) return;
    if (!dirty) return onClose();
    Alert.alert('Закрыть без сохранения?', 'Изменения будут потеряны.', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Закрыть', style: 'destructive', onPress: onClose },
    ]);
  }
  async function submit() {
    if (!name.trim() || saving.current) return;
    saving.current = true;
    setError('');
    try {
      await save.mutateAsync({ id: location?.id, name: name.trim(), address: address.trim() || null });
      onClose();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      saving.current = false;
    }
  }

  return <WarehouseWorkspace title={location ? 'Редактировать склад' : 'Новый склад'} onClose={close}
    footer={<Button title="Сохранить" loading={save.isPending} disabled={!name.trim() || !dirty} onPress={() => void submit()} />}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={styles.stack}>
        <WarehouseDirectoryField label="Название" wide={wide}>
          <Field accessibilityLabel="Название" value={name} onChangeText={setName} maxLength={80} editable={!save.isPending} />
        </WarehouseDirectoryField>
        <WarehouseDirectoryField label="Адрес" wide={wide}>
          <Field accessibilityLabel="Адрес" value={address} onChangeText={setAddress} maxLength={500} editable={!save.isPending}
            multiline style={styles.multiline} />
        </WarehouseDirectoryField>
      </Card>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  surface: { borderRadius: radius.lg, backgroundColor: colors.card },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  stack: { gap: spacing.md },
  search: { flexGrow: 1, flexBasis: 160, maxWidth: 300 },
  nameCell: { alignSelf: 'stretch', paddingVertical: 3 },
  multiline: { height: 68, paddingTop: spacing.sm, textAlignVertical: 'top' },
  muted: { marginTop: -3, fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger },
});
