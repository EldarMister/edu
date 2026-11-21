import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { StyleSheet, Switch } from 'react-native';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { Select } from '@/components/Select';
import { Button, Field } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { colors, radius, spacing } from '@/theme';
import { displayOrderNumber, money, orderItemDisplayName, paymentMethodLabel } from '@/utils/format';
import type { Order } from '@/types';
import {
  useCreateOrderRefund, useDecideOrderRefund, useRefundQuote,
  type OrderRefund, type RefundApproval, type RefundQuote,
} from './api';
import { canConfirmRefund, confirmedRefundApproval, refundableQuantity } from './refundRules';

function ApprovalSwitch({ label, checked, onChange, disabled }: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <View style={styles.row}>
      <Text style={styles.optionLabel} translate>{label}</Text>
      <Switch accessibilityLabel={t(label)} value={checked} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

function ConfirmationFields({ refund, value, onChange, disabled }: {
  refund: Pick<RefundQuote, 'requireFiscalReference' | 'paymentParts' | 'items'>;
  value: RefundApproval;
  onChange: (next: RefundApproval) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.stack}>
      {refund.paymentParts.length > 0 ? (
        <ApprovalSwitch label="Деньги возвращены гостю указанными способами" checked={value.fundsReturned ?? false}
          onChange={(fundsReturned) => onChange({ ...value, fundsReturned })} disabled={disabled} />
      ) : null}
      {refund.requireFiscalReference ? (
        <View style={styles.group}>
          <Field label="Номер чека возврата ККМ" value={value.fiscalRefundReference ?? ''} maxLength={120}
            onChangeText={(fiscalRefundReference) => onChange({ ...value, fiscalRefundReference })} editable={!disabled} />
          <Text style={styles.muted} translate>Проведите фискальный возврат на ККМ и укажите номер полученного чека.</Text>
        </View>
      ) : null}
      {refund.items.length > 0 ? (
        <ApprovalSwitch label="Вернуть на склад пригодные к продаже товары" checked={value.restockGoods ?? false}
          onChange={(restockGoods) => onChange({ ...value, restockGoods })} disabled={disabled} />
      ) : null}
    </View>
  );
}

function RefundAmount({ refund }: { refund: Pick<RefundQuote, 'amount' | 'paymentParts'> }) {
  const perMethod = new Map<string, number>();
  for (const part of refund.paymentParts) {
    perMethod.set(part.method, (perMethod.get(part.method) ?? 0) + Number(part.amount));
  }
  return (
    <View style={styles.amountCard}>
      <View style={styles.row}>
        <Text style={styles.strong} translate>К возврату</Text>
        <Text style={styles.strong}>{money(refund.amount)}</Text>
      </View>
      {[...perMethod].map(([method, amount]) => (
        <View key={method} style={styles.row}>
          <Text style={styles.muted} translate>{paymentMethodLabel(method)}</Text>
          <Text style={styles.muted}>{money(amount)}</Text>
        </View>
      ))}
    </View>
  );
}

export function OrderRefundForm({ order, mode, onClose }: { order: Order; mode: 'request' | 'manage'; onClose: () => void }) {
  const push = useNotifications((state) => state.push);
  const t = useT();
  const [requestId, setRequestId] = useState(randomUUID);
  const [reason, setReason] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [approvalDraft, setApprovalDraft] = useState<{ version: string; value: RefundApproval }>();
  const eligible = order.items.filter((item) => refundableQuantity(item) > 0);
  const selected = eligible.find((item) => item.id === itemId);
  const maxQuantity = selected ? refundableQuantity(selected) : 0;
  const enteredQuantity = Number(quantity);
  const validSelection = !itemId || (Number.isInteger(enteredQuantity) && enteredQuantity >= 1 && enteredQuantity <= maxQuantity);
  const selection = itemId ? { itemId, quantity: enteredQuantity } : {};
  const quote = useRefundQuote(order.id, selection, validSelection);
  const refund = quote.data;
  const mutation = useCreateOrderRefund(order.id, mode);
  const requesting = mode === 'request';
  const approval = approvalDraft && approvalDraft.version === refund?.version ? approvalDraft.value : {};
  const label = requesting ? 'Запросить возврат' : 'Оформить возврат';
  const canSubmit = validSelection && !mutation.isPending && !!reason.trim() && !!refund
    && !quote.isError && !quote.isFetching && (requesting || canConfirmRefund(refund, approval));

  function resetSelection() {
    setApprovalDraft(undefined);
    setRequestId(randomUUID());
    mutation.reset();
  }

  async function submit() {
    if (!canSubmit || !refund) return;
    try {
      await mutation.mutateAsync({
        ...selection,
        reason: reason.trim(),
        requestId,
        quoteVersion: refund.version,
        approval: requesting ? undefined : confirmedRefundApproval(approval),
      });
      const message = requesting ? 'Заявка на возврат отправлена' : 'Возврат оформлен';
      push({ message: t(message), type: 'success', at: new Date().toISOString() });
      onClose();
    } catch {
      void quote.refetch();
    }
  }

  return (
    <BottomSheet visible onClose={() => { if (!mutation.isPending) onClose(); }} title={label}
      draggable={!mutation.isPending} maxHeight="92%"
      footer={<Button title={label} disabled={!canSubmit} loading={mutation.isPending} onPress={() => void submit()} />}>
      <SheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.stack}>
        <View style={styles.group}>
          <Text style={styles.strong} translate>Что вернуть</Text>
          <Select value={itemId} title="Что вернуть" disabled={mutation.isPending}
            options={[{ value: '', label: 'Весь остаток заказа' }, ...eligible.map((item) => ({
              value: item.id, label: orderItemDisplayName(item), translate: false,
            }))]}
            onChange={(value) => { setItemId(value); setQuantity('1'); resetSelection(); }} />
        </View>
        {itemId ? (
          <View style={styles.group}>
            <Field label="Количество для возврата" value={quantity} editable={!mutation.isPending}
              keyboardType="number-pad" onChangeText={(value) => { setQuantity(value); resetSelection(); }} />
            <Text style={styles.muted}><Text translate>Доступно для возврата</Text> · {maxQuantity}</Text>
          </View>
        ) : null}
        <Field label="Причина возврата" value={reason} maxLength={300} editable={!mutation.isPending}
          multiline style={styles.reasonInput} onChangeText={setReason} />
        {validSelection && quote.isFetching ? <Text style={styles.muted} translate>Рассчитываем сумму возврата…</Text> : null}
        {validSelection && quote.error ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>{apiError(quote.error)}</Text>
            <Button title="Повторить" size="md" variant="secondary" onPress={() => void quote.refetch()} />
          </View>
        ) : null}
        {validSelection && refund && !quote.error ? (
          <>
            <RefundAmount refund={refund} />
            {!requesting ? <ConfirmationFields refund={refund} value={approval}
              onChange={(value) => setApprovalDraft({ version: refund.version, value })}
              disabled={mutation.isPending || quote.isFetching} /> : null}
          </>
        ) : null}
        {mutation.error ? <Text accessibilityRole="alert" style={styles.error}>{apiError(mutation.error)}</Text> : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

export function ReviewOrderRefund({ refund, onClose }: { refund: OrderRefund; onClose: () => void }) {
  const [approval, setApproval] = useState<RefundApproval>({});
  const mutation = useDecideOrderRefund(refund.id);
  const push = useNotifications((state) => state.push);
  const t = useT();

  async function decide(decision: 'approve' | 'reject') {
    try {
      await mutation.mutateAsync({
        decision,
        approval: decision === 'approve' ? confirmedRefundApproval(approval) : undefined,
      });
      const message = decision === 'approve' ? 'Возврат оформлен' : 'Заявка на возврат отклонена';
      push({ message: t(message), type: 'success', at: new Date().toISOString() });
      onClose();
    } catch {
      // Keep the review open so the administrator can read the error.
    }
  }

  return (
    <BottomSheet visible onClose={() => { if (!mutation.isPending) onClose(); }} title="Заявка на возврат"
      draggable={!mutation.isPending} maxHeight="92%"
      footer={(
        <View style={styles.group}>
          <Button title="Подтвердить возврат" disabled={!canConfirmRefund(refund, approval) || mutation.isPending}
            loading={mutation.isPending && mutation.variables?.decision === 'approve'} onPress={() => void decide('approve')} />
          <Button title="Отклонить заявку" variant="secondary" danger disabled={mutation.isPending}
            loading={mutation.isPending && mutation.variables?.decision === 'reject'} onPress={() => void decide('reject')} />
        </View>
      )}>
      <SheetScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
        <Text style={styles.strong}><Text translate>Заказ</Text> {displayOrderNumber(refund.orderNumber)} · {refund.requestedByName}</Text>
        <Text style={styles.muted} translate>{refund.itemId ? 'Возврат позиции' : 'Возврат остатка заказа'}</Text>
        <Text style={styles.body}>{refund.reason}</Text>
        <View style={styles.group}>
          {refund.items.map((item) => (
            <View style={styles.row} key={item.itemId}>
              <Text style={styles.optionLabel}>{item.quantity} × {item.name}</Text>
              <Text style={styles.body}>{money(item.amount)}</Text>
            </View>
          ))}
        </View>
        <RefundAmount refund={refund} />
        <ConfirmationFields refund={refund} value={approval} onChange={setApproval} disabled={mutation.isPending} />
        {mutation.error ? <Text accessibilityRole="alert" style={styles.error}>{apiError(mutation.error)}</Text> : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, paddingBottom: spacing.sm },
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  amountCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  strong: { fontWeight: '600', color: colors.textPrimary },
  body: { color: colors.textPrimary },
  muted: { color: colors.textSecondary },
  optionLabel: { color: colors.textPrimary, flex: 1 },
  reasonInput: { minHeight: 80, paddingTop: spacing.md, textAlignVertical: 'top' },
  error: { color: colors.danger },
});
