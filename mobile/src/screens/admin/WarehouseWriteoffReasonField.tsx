import React, { useState } from 'react';
import { Select } from '@/components/Select';
import { Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useCreateWriteoffReason, useWriteoffReasons, type StockDocument, type StockDocumentReason } from '@/services/api/stockDocuments';
import { colors, spacing } from '@/theme';

const builtinReasons: { value: StockDocumentReason; label: string }[] = [
  { value: 'spoilage', label: 'Порча' }, { value: 'expired', label: 'Просрочка' },
  { value: 'damage', label: 'Брак' }, { value: 'staff_meal', label: 'Питание персонала' },
  { value: 'tasting', label: 'Дегустация' }, { value: 'household', label: 'Хозяйственные нужды' },
  { value: 'other', label: 'Другое' },
];
const addReason = '__add_reason';
export const noWriteoffReason = '__none';

export function useWriteoffReasonOptions(enabled = true) {
  const reasons = useWriteoffReasons(enabled);
  return { reasons, options: reasons.data?.map(({ id, label, custom }) => ({ value: id, label, translate: !custom })) ?? builtinReasons };
}

export function writeoffReasonLabel(document: StockDocument) {
  return document.reasonLabel ?? builtinReasons.find(({ value }) => value === document.reason)?.label ?? 'Без причины';
}

export function writeoffReasonInput(value: string, savedCustomId?: string | null) {
  const builtin = builtinReasons.find((reason) => reason.value === value);
  return { reason: builtin?.value ?? null,
    ...(value && !builtin ? { writeoffReasonId: value } : savedCustomId ? { writeoffReasonId: null } : {}) };
}

export function WarehouseWriteoffReasonField({ value, fallbackLabel, onChange, disabled }: {
  value: string; fallbackLabel?: string | null; onChange: (value: string) => void; disabled: boolean;
}) {
  const { canAction } = usePermissions();
  const { reasons, options } = useWriteoffReasonOptions();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [expense, setExpense] = useState<'cost' | 'expense'>('cost');
  const create = useCreateWriteoffReason();
  const fallback = value && fallbackLabel && !options.some((option) => option.value === value)
    ? [{ value, label: fallbackLabel, translate: false }] : [];
  function close() {
    setShowCreate(false);
    setName('');
    setExpense('cost');
    create.reset();
  }
  return <>
    <Select title="Причина списания" value={value} disabled={disabled || showCreate}
      options={[{ value: '', label: 'Без причины' }, ...options, ...fallback,
        ...(canAction('warehouseSettings') ? [{ value: addReason, label: '+ Добавить причину' }] : [])]}
      onChange={(next) => { if (next === addReason) setShowCreate(true); else onChange(next); }} />
    {reasons.isError && <Button title="Повторить загрузку причин" variant="secondary" onPress={() => void reasons.refetch()} />}
    {showCreate && <Card style={{ gap: spacing.sm }}>
      <Text translate>Новая причина списания</Text>
      <Field label="Название" value={name} maxLength={120} onChangeText={setName} editable={!disabled && !create.isPending} />
      <Text translate>Учитывать в блоке P&L</Text>
      <Select title="Учитывать в блоке P&L" value={expense} onChange={setExpense} disabled={disabled || create.isPending}
        options={[{ value: 'cost', label: 'Себестоимость' }, { value: 'expense', label: 'Расходы' }]} />
      {create.isError && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{apiError(create.error)}</Text>}
      <Button title="Сохранить причину" disabled={!name.trim() || disabled || create.isPending} onPress={() => {
        create.mutate({ name, expense: expense === 'expense' }, { onSuccess: (reason) => { onChange(reason.id); close(); } });
      }} />
      <Button title="Отмена" variant="secondary" disabled={create.isPending} onPress={close} />
    </Card>}
  </>;
}
