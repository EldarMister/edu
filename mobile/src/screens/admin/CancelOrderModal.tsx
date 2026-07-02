import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';

const REASONS = ['Клиент передумал', 'Ошибка официанта', 'Долгое ожидание', 'Другая причина'];

/** Отмена заказа с обязательной причиной (порт PWA CancelOrderModal). */
export function CancelOrderModal({
  visible,
  orderLabel,
  submitting,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  orderLabel: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [comment, setComment] = useState('');
  const isOther = reason === 'Другая причина';
  const finalReason = isOther ? comment.trim() : reason;
  const valid = !isOther || comment.trim().length > 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Отменить заказ?"
      footer={
        <View style={styles.footer}>
          <Button title="Отмена" variant="secondary" size="lg" style={{ flex: 1 }} onPress={onClose} />
          <Button
            title="Отменить заказ"
            variant="danger"
            size="lg"
            style={{ flex: 1 }}
            loading={submitting}
            disabled={!valid}
            onPress={() => onConfirm(finalReason)}
          />
        </View>
      }
    >
      <Text style={styles.orderLabel}>{orderLabel}</Text>
      <Text style={styles.reasonLabel}>Причина отмены</Text>
      <View style={{ gap: spacing.sm }}>
        {REASONS.map((r) => {
          const active = reason === r;
          return (
            <FastPressable
              key={r}
              onPress={() => setReason(r)}
              style={[styles.reasonRow, active && styles.reasonRowActive]}
            >
              <View style={[styles.radio, active && { borderColor: colors.primary }]}>
                {active ? <View style={styles.radioDot} /> : null}
              </View>
              <Text style={[styles.reasonText, active && { color: colors.textPrimary }]}>{r}</Text>
            </FastPressable>
          );
        })}
      </View>
      {isOther ? (
        <TextInput
          style={styles.textarea}
          placeholder="Опишите причину…"
          placeholderTextColor={colors.textLight}
          value={comment}
          onChangeText={setComment}
          multiline
          autoFocus
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: spacing.sm },
  orderLabel: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.md },
  reasonLabel: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  reasonRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.textLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  reasonText: { fontSize: fontSize.base, color: colors.textSecondary },
  textarea: {
    marginTop: spacing.md,
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
});
