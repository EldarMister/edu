import React, { useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ScrollView, View } from '@/components/themed';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Text } from '@/components/typography';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { PwaIcon } from '@/components/PwaIcon';
import { Button, Field, Toggle } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePrepStations, usePrepStationMutations } from '@/services/api/prepStations';
import { useAuth } from '@/store/auth';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { PrepStationEntry } from '@/types';
import { AdminLoadingSkeleton } from './AdminLoadingSkeleton';
import { WarehouseDirectorySearch, WarehouseDirectorySort } from './WarehouseDirectoryTable';
import { WarehouseWorkspace } from './WarehouseWorkspace';

type StationStatus = '' | 'active' | 'archived';
const STATUS_OPTIONS: { value: StationStatus; label: string }[] = [
  { value: '', label: 'Все станции' },
  { value: 'active', label: 'Активные' },
  { value: 'archived', label: 'В архиве' },
];

export function PrepStationsPage() {
  const editable = useAuth((state) => state.user?.role === 'OWNER');
  const t = useT();
  const query = usePrepStations();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StationStatus>('');
  const [ascending, setAscending] = useState(true);
  const [editor, setEditor] = useState<PrepStationEntry | 'new' | null>(null);
  const needle = search.trim().toLocaleLowerCase('ru');
  const rows = (query.data ?? []).map((station) => ({
    station,
    label: station.isBuiltIn ? t(station.name) : station.name,
  })).filter(({ station, label }) => (
    (!status || station.isActive === (status === 'active')) && label.toLocaleLowerCase('ru').includes(needle)
  )).sort((a, b) => a.label.localeCompare(b.label, 'ru') * (ascending ? 1 : -1));

  return <>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {query.isLoading && <AdminLoadingSkeleton />}
      {query.isError && !query.data && <View style={styles.toolbar}>
        <Text accessibilityRole="alert" style={styles.error}>{apiError(query.error)}</Text>
        <Button title="Повторить" variant="secondary" size="md" onPress={() => void query.refetch()} />
      </View>}
      {query.data && <View style={styles.table}>
        <AnchoredSelectScope>
          <View style={styles.toolbar}>
            <WarehouseDirectorySearch label="Поиск станций" placeholder={t('Быстрый поиск')} value={search} onChange={setSearch} />
            <Select title="Статус станции" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
            {editable && <Button title="Добавить" size="md" onPress={() => setEditor('new')} />}
          </View>
        </AnchoredSelectScope>
        <View style={styles.row}>
          <View style={styles.nameCell}>
            <WarehouseDirectorySort ascending={ascending} onToggle={() => setAscending((value) => !value)} />
          </View>
          <Text style={[styles.status, styles.muted]} translate>Статус</Text>
          {editable && <View style={styles.action} />}
        </View>
        {rows.map(({ station, label }) => <View key={station.id} style={styles.row}>
          {editable ? <FastPressable style={styles.nameCell} accessibilityRole="button"
            accessibilityLabel={t('Редактировать станцию') + ' ' + label} onPress={() => setEditor(station)}>
            <Text style={styles.link} numberOfLines={1}>{label}</Text>
          </FastPressable> : <Text style={[styles.nameCell, styles.name]} numberOfLines={1}>{label}</Text>}
          <Text style={[styles.status, styles.muted]} translate>{station.isActive ? 'Активна' : 'В архиве'}</Text>
          {editable && <FastPressable accessibilityRole="button"
            accessibilityLabel={t('Редактировать станцию') + ' ' + label} onPress={() => setEditor(station)} style={styles.action}>
            <PwaIcon name="pencil" size={16} color={colors.textMuted} />
          </FastPressable>}
        </View>)}
        {!rows.length && <Text style={[styles.notice, styles.muted]} translate>{needle || status ? 'Станции не найдены' : 'Станций пока нет'}</Text>}
      </View>}
    </ScrollView>
    {editable && editor && <StationEditor station={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />}
  </>;
}

function StationEditor({ station, onClose }: { station?: PrepStationEntry; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const { create, update } = usePrepStationMutations();
  const t = useT();
  const [name, setName] = useState(station?.name ?? '');
  const [active, setActive] = useState(station?.isActive ?? true);
  const [error, setError] = useState('');
  const saving = create.isPending || update.isPending;

  async function save() {
    const value = name.trim();
    if (!value || saving) return;
    setError('');
    try {
      if (!station) await create.mutateAsync(value);
      else if (station.name !== value || station.isActive !== active) {
        await update.mutateAsync({ id: station.id, name: value, isActive: active });
      }
      onClose();
    } catch (cause) {
      setError(apiError(cause));
    }
  }

  const close = () => { if (!saving) onClose(); };
  const footer = <Button title="Сохранить" disabled={!name.trim()} loading={saving} onPress={() => void save()} />;
  const fields = <>
      <Field label="Название" accessibilityLabel={t('Название станции')} value={name}
        onChangeText={setName} maxLength={80} editable={!saving} />
      {station && <View style={styles.editorStatus}>
        <Text style={styles.name} translate>Активна</Text>
        <Toggle checked={active} onChange={setActive} disabled={saving} accessibilityLabel="Активна" />
      </View>}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </>;
  if (station) return <BottomSheet visible title="Редактирование станции"
    presentation={width >= 768 ? 'dialog' : 'bottom'} dismissible={!saving} onClose={close} footer={footer}>
    {fields}
  </BottomSheet>;
  return <WarehouseWorkspace title="Новая станция" onClose={close} footer={footer}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {fields}
    </ScrollView>
  </WarehouseWorkspace>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  table: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md },
  row: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  nameCell: { flex: 1, minWidth: 0 },
  name: { fontSize: fontSize.base, color: colors.textPrimary },
  status: { minWidth: 70 },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  editorStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.sm },
  action: { width: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  link: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '500' },
  notice: { padding: spacing.md, textAlign: 'center' },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
