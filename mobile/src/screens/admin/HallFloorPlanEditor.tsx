import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, type View as NativeView, type ViewStyle } from 'react-native';
import { View } from '@/components/themed';
import { Alert, Text, TextInput } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { FloorPlanCanvas } from '@/components/FloorPlanCanvas';
import { useDeletionParticles } from '@/components/DeletionParticles';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useFloorPlanMutations, type AdminHall, type AdminTableItem } from '@/services/api/admin';
import { colors, spacing } from '@/theme';
import type { FloorPlanTable } from '@/types';
import { layoutFloorTables, shiftFloorTable, tableLabel } from '@/utils/floorPlan';

export function HallFloorPlanEditor({ halls, initialHallId, editable, onClose, onAdd, onEdit, onRemove }: {
  halls: AdminHall[];
  initialHallId?: string;
  editable: boolean;
  onClose: () => void;
  onAdd: (hall: AdminHall) => void;
  onEdit: (hall: AdminHall, table: AdminTableItem) => void;
  onRemove: (table: AdminTableItem, onRemoved?: () => void) => void;
}) {
  const [hallId, setHallId] = useState(initialHallId ?? '');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<{ hallId: string; version: number; tables: FloorPlanTable[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const [error, setError] = useState('');
  const { save } = useFloorPlanMutations();
  const particles = useDeletionParticles();
  const hall = halls.find(({ id }) => id === hallId) ?? halls[0];
  const activeDraft = draft?.hallId === hall?.id ? draft : null;
  const placements = layoutFloorTables(hall?.tables ?? [], activeDraft?.tables ?? hall?.floorPlan);
  const chosen = placements.find(({ tableId }) => tableId === selectedId);
  const tablesById = new Map(hall?.tables.map((table) => [table.id, table]));
  const selectedTable = tablesById.get(selectedId);
  const canEdit = editable && !save.isPending;
  const overflow = (hall?.tables.length ?? 0) > placements.length;

  function change(table: FloorPlanTable, patch: Partial<FloorPlanTable>) {
    if (!hall || !canEdit) return;
    setError('');
    setDraft((current) => {
      const currentDraft = current?.hallId === hall.id ? current : null;
      const tables = layoutFloorTables(hall.tables, currentDraft?.tables ?? hall.floorPlan);
      const existing = tables.find(({ tableId }) => tableId === table.tableId);
      if (!existing || Object.entries(patch).every(([key, value]) => existing[key as keyof FloorPlanTable] === value)) return current;
      return {
        hallId: hall.id,
        version: currentDraft?.version ?? hall.floorPlanVersion ?? 0,
        tables: tables.map((item) => item.tableId === table.tableId ? { ...item, ...patch } : item),
      };
    });
  }

  async function saveDraft() {
    if (!activeDraft || !canEdit || overflow) return;
    try {
      setError('');
      await save.mutateAsync({ id: activeDraft.hallId, version: activeDraft.version, tables: placements });
      setDraft(null);
    } catch (failure) {
      setError(apiError(failure));
    }
  }

  function close() {
    if (save.isPending) { setPanelKey((current) => current + 1); return; }
    if (!activeDraft) { onClose(); return; }
    Alert.alert('Выйти без сохранения?', 'Изменения карты зала будут потеряны.', [
      { text: 'Остаться', style: 'cancel', onPress: () => setPanelKey((current) => current + 1) },
      { text: 'Выйти', style: 'destructive', onPress: onClose },
    ], { cancelable: false });
  }

  return <BottomSheet key={panelKey} visible expanded draggable={false} onClose={close} title="Карта зала" panelStyle={{ maxWidth: 760 }}
    footer={editable && hall ? <View style={styles.actions}>
      <Button title="Отменить правки" variant="secondary" size="md" disabled={!activeDraft || !canEdit}
        onPress={() => { setDraft(null); setError(''); }} />
      <Button title="Сохранить карту" size="md" disabled={!activeDraft || overflow} loading={save.isPending} onPress={() => void saveDraft()} />
    </View> : undefined}>
    {!hall ? <Text style={styles.hint} translate>Добавьте зал, чтобы составить карту.</Text> :
      <View style={styles.frame}><SheetScrollView contentContainerStyle={styles.content} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled">
        <View style={styles.actions}>
          <View style={styles.select}>
            <Select title="Зал на карте" value={hall.id} disabled={!!activeDraft}
              options={halls.map(({ id, name }) => ({ value: id, label: name, translate: false }))}
              onChange={(id) => { setHallId(id); setSelectedId(''); setError(''); }} />
          </View>
          {editable ? <Button title="Добавить стол" size="md" variant="secondary" disabled={!canEdit} onPress={() => onAdd(hall)} /> : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {overflow ? <Text style={styles.error} translate>Освободите на карте место для всех столов.</Text> : null}
        {editable ? <Text style={styles.hint} translate>Перетащите стол, чтобы переместить его. Потяните за угол, чтобы изменить размер.</Text> : null}
        {chosen && selectedTable && editable ? <View style={styles.selected}>
          <Text style={styles.label}>{tableLabel(selectedTable)}</Text>
          <View style={styles.actions}>
            <View style={styles.select}>
              <Select title="Форма стола" value={chosen.shape} disabled={!canEdit}
                options={[{ value: 'rectangle', label: 'Прямоугольная' }, { value: 'round', label: 'Круглая' }]}
                onChange={(shape) => change(chosen, { shape })} />
            </View>
            <TextInput value={chosen.label ?? ''} editable={canEdit} maxLength={30} placeholder="Подпись на карте"
              placeholderTextColor={colors.textLight} accessibilityLabel="Подпись стола на карте" style={styles.input}
              onChangeText={(label) => change(chosen, { label })} />
          </View>
          <View style={styles.actions}>
            <Button title="Редактировать стол" size="md" variant="secondary" disabled={!canEdit} onPress={() => onEdit(hall, selectedTable)} />
            <Button title="Удалить стол" size="md" variant="secondary" danger disabled={!canEdit} onPress={() => onRemove(selectedTable, particles.capture(selectedId))} />
          </View>
        </View> : null}
        <FloorPlanCanvas placements={placements} renderTable={(table, style, unit) => {
          const item = tablesById.get(table.tableId);
          if (!item) return null;
          return <MapTable key={table.tableId} sourceRef={(view) => particles.register(table.tableId, view)} table={table} style={style} unit={unit}
            label={table.label?.trim() || item.name || String(item.number)} selected={table.tableId === selectedId}
            editable={canEdit} onSelect={() => setSelectedId(table.tableId)} onDrag={setDragging}
            onMove={(original, dx, dy, resize) => change(table, shiftFloorTable(original, dx, dy, resize))} />;
        }} />
      </SheetScrollView>{particles.overlay}</View>}
  </BottomSheet>;
}

function MapTable({ sourceRef, table, style, unit, label, selected, editable, onSelect, onDrag, onMove }: {
  sourceRef: (view: NativeView | null) => void;
  table: FloorPlanTable; style: ViewStyle; unit: number; label: string; selected: boolean; editable: boolean;
  onSelect: () => void; onDrag: (dragging: boolean) => void;
  onMove: (original: FloorPlanTable, dx: number, dy: number, resize: boolean) => void;
}) {
  const current = useRef({ table, unit, editable, onSelect, onDrag, onMove });
  current.current = { table, unit, editable, onSelect, onDrag, onMove };
  const original = useRef(table);
  const makePan = (resize: boolean) => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => current.current.editable && Math.hypot(gesture.dx, gesture.dy) >= 5,
    onPanResponderGrant: () => {
      original.current = current.current.table;
      current.current.onSelect();
      current.current.onDrag(true);
    },
    onPanResponderMove: (_event, { dx, dy }) => {
      const cell = current.current.unit;
      if (cell > 0) current.current.onMove(original.current, Math.round(dx / cell), Math.round(dy / cell), resize);
    },
    onPanResponderRelease: () => current.current.onDrag(false),
    onPanResponderTerminate: () => current.current.onDrag(false),
    onPanResponderTerminationRequest: () => false,
  });
  const drag = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const resize = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  drag.current ??= makePan(false);
  resize.current ??= makePan(true);
  const actions = [{ name: 'moveLeft', label: 'Влево' }, { name: 'moveRight', label: 'Вправо' },
    { name: 'moveUp', label: 'Вверх' }, { name: 'moveDown', label: 'Вниз' }];
  const directions = { moveLeft: [-1, 0], moveRight: [1, 0], moveUp: [0, -1], moveDown: [0, 1] } as const;

  return <View ref={sourceRef} collapsable={false} style={[styles.table, style, selected && styles.tableSelected]}>
    <View style={StyleSheet.absoluteFill} {...drag.current.panHandlers}>
      <FastPressable style={styles.tableTouch} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
        accessibilityActions={editable ? actions : undefined} onAccessibilityAction={({ nativeEvent }) => {
          const direction = directions[nativeEvent.actionName as keyof typeof directions];
          if (editable && direction) onMove(table, direction[0], direction[1], false);
        }} onPress={onSelect}>
        <Text style={styles.label} numberOfLines={2}>{label}</Text>
      </FastPressable>
    </View>
    {selected && editable ? <View style={styles.resize} {...resize.current.panHandlers}>
      <View style={styles.resizeTouch} accessible accessibilityLabel="Изменить размер стола" accessibilityActions={actions}
        onAccessibilityAction={({ nativeEvent }) => {
          const direction = directions[nativeEvent.actionName as keyof typeof directions];
          if (direction) onMove(table, direction[0], direction[1], true);
        }}>
        <Text style={styles.resizeText}>↘</Text>
      </View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  content: { gap: spacing.md },
  select: { flex: 1, minWidth: 140 },
  selected: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md },
  input: { flex: 1, minWidth: 140, minHeight: 42, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, paddingHorizontal: spacing.sm, borderRadius: 8 },
  hint: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  table: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  tableSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft, zIndex: 2 },
  tableTouch: { flex: 1, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  resize: { position: 'absolute', right: 0, bottom: 0, width: 28, height: 28 },
  resizeTouch: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 7 },
  resizeText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
