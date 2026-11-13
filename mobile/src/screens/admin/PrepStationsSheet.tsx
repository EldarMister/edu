import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Text, TextInput } from '@/components/typography';
import { Button, Loading } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePrepStations, usePrepStationMutations } from '@/services/api/prepStations';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { PrepStationEntry } from '@/types';

export function PrepStationsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const query = usePrepStations();
  const { create, update } = usePrepStationMutations();
  const [editing, setEditing] = useState<PrepStationEntry | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const busy = create.isPending || update.isPending;

  function reset() {
    setEditing(null);
    setName('');
    setError('');
  }

  async function save() {
    const value = name.trim();
    if (!value || busy) return;
    setError('');
    try {
      if (editing) await update.mutateAsync({ id: editing.id, name: value });
      else await create.mutateAsync(value);
      reset();
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function toggle(station: PrepStationEntry) {
    setError('');
    try {
      await update.mutateAsync({ id: station.id, isActive: !station.isActive });
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <BottomSheet visible onClose={onClose} title="Станции приготовления" maxHeight="88%">
      <SheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {query.isLoading ? <Loading /> : null}
        {query.isError && !query.data ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>{apiError(query.error)}</Text>
            <Button title="Повторить" variant="secondary" onPress={() => void query.refetch()} />
          </>
        ) : null}
        {query.data ? (
          <>
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                maxLength={80}
                placeholder={t('Название станции')}
                placeholderTextColor={colors.textLight}
                accessibilityLabel={t('Название станции')}
                editable={!busy}
              />
              <Button title={editing ? 'Сохранить' : 'Добавить'} loading={create.isPending} disabled={!name.trim() || busy} onPress={() => void save()} />
              {editing ? <Button title="Отмена" variant="secondary" disabled={busy} onPress={reset} /> : null}
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {query.stations.map((station) => (
              <View key={station.id} style={styles.row}>
                <View style={styles.station}>
                  <Text style={styles.name} translate={station.isBuiltIn}>{station.name}</Text>
                  {!station.isActive ? <Text style={styles.archived} translate>В архиве</Text> : null}
                </View>
                <View style={styles.actions}>
                  <FastPressable accessibilityRole="button" onPress={() => {
                    setEditing(station);
                    setName(station.name);
                    setError('');
                  }} disabled={busy}>
                    <Text style={styles.action} translate>Изменить</Text>
                  </FastPressable>
                  <FastPressable accessibilityRole="button" disabled={busy} onPress={() => void toggle(station)}>
                    <Text style={styles.action} translate>{station.isActive ? 'Удалить' : 'Восстановить'}</Text>
                  </FastPressable>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.md },
  form: { gap: spacing.sm },
  input: {
    minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, color: colors.textPrimary,
  },
  row: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  station: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm },
  name: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  archived: { fontSize: fontSize.xs, color: colors.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  action: { color: colors.primary, paddingVertical: spacing.xs },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
