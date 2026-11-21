import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ScrollView, View } from '@/components/themed';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Text } from '@/components/typography';
import { Button, Field, Loading } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePrepStations, usePrepStationMutations } from '@/services/api/prepStations';
import { useAuth } from '@/store/auth';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { PrepStationEntry } from '@/types';
import { WarehouseWorkspace } from './WarehouseWorkspace';

export function PrepStationsPage() {
  const editable = useAuth((state) => state.user?.role === 'OWNER');
  const t = useT();
  const query = usePrepStations();
  const { update } = usePrepStationMutations();
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<PrepStationEntry | 'new' | null>(null);
  const [statusError, setStatusError] = useState('');
  const needle = search.trim().toLocaleLowerCase('ru');
  const rows = (query.data ?? []).map((station) => ({
    station,
    label: station.isBuiltIn ? t(station.name) : station.name,
  })).filter(({ label }) => label.toLocaleLowerCase('ru').includes(needle))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  async function toggle(station: PrepStationEntry) {
    if (!editable || update.isPending) return;
    setStatusError('');
    try {
      await update.mutateAsync({ id: station.id, isActive: !station.isActive });
    } catch (cause) {
      setStatusError(apiError(cause));
    }
  }

  return <>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {query.isLoading && <Loading />}
      {query.isError && !query.data && <View style={styles.toolbar}>
        <Text accessibilityRole="alert" style={styles.error}>{apiError(query.error)}</Text>
        <Button title="Повторить" variant="secondary" size="md" onPress={() => void query.refetch()} />
      </View>}
      {query.data && <View style={styles.table}>
        <View style={styles.toolbar}>
          <Field containerStyle={styles.search} value={search} onChangeText={setSearch}
            accessibilityLabel={t('Поиск станций')} placeholder={t('Быстрый поиск')} />
          {editable && <Button title="Добавить" size="md" disabled={update.isPending} onPress={() => setEditor('new')} />}
        </View>
        {statusError ? <Text accessibilityRole="alert" style={[styles.notice, styles.error]}>{statusError}</Text> : null}
        <View style={styles.row}>
          <Text style={[styles.nameCell, styles.muted]} translate>Название</Text>
          <Text style={[styles.status, styles.muted]} translate>Статус</Text>
        </View>
        {rows.map(({ station, label }) => <View key={station.id} style={styles.row}>
          <Text style={[styles.nameCell, styles.name]}>{label}</Text>
          <Text style={[styles.status, styles.muted]} translate>{station.isActive ? 'Активна' : 'В архиве'}</Text>
          {editable && <View style={styles.actions}>
            <FastPressable accessibilityRole="button" accessibilityLabel={t('Редактировать станцию') + ' ' + label}
              onPress={() => setEditor(station)} disabled={update.isPending} style={styles.action}>
              <Text style={styles.link} translate>Ред.</Text>
            </FastPressable>
            <FastPressable accessibilityRole="button"
              accessibilityLabel={t(station.isActive ? 'Архивировать станцию' : 'Восстановить станцию') + ' ' + label}
              onPress={() => void toggle(station)} disabled={update.isPending} style={styles.action}>
              <Text style={styles.link} translate>{station.isActive ? 'В архив' : 'Восстановить'}</Text>
            </FastPressable>
          </View>}
        </View>)}
        {!rows.length && <Text style={[styles.notice, styles.muted]} translate>{needle ? 'Станции не найдены' : 'Станций пока нет'}</Text>}
      </View>}
    </ScrollView>
    {editable && editor && <StationEditor station={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />}
  </>;
}

function StationEditor({ station, onClose }: { station?: PrepStationEntry; onClose: () => void }) {
  const { create, update } = usePrepStationMutations();
  const t = useT();
  const [name, setName] = useState(station?.name ?? '');
  const [error, setError] = useState('');
  const saving = create.isPending || update.isPending;

  async function save() {
    const value = name.trim();
    if (!value || saving) return;
    setError('');
    try {
      if (!station) await create.mutateAsync(value);
      else if (station.name !== value) await update.mutateAsync({ id: station.id, name: value });
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
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </>;
  if (station) return <BottomSheet visible title="Редактирование станции" onClose={close} footer={footer}>
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
  search: { flex: 1, minWidth: 120 },
  row: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  nameCell: { flex: 1, minWidth: 0 },
  name: { fontSize: fontSize.base, color: colors.textPrimary },
  status: { minWidth: 70 },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { minHeight: 36, paddingHorizontal: 3, justifyContent: 'center' },
  link: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '500' },
  notice: { padding: spacing.md, textAlign: 'center' },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
