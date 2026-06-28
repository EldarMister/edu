import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useReceiptPrint } from '@/store/receiptPrint';
import { displayOrderNumber, money, orderItemDisplayName } from '@/utils/format';

export function ReceiptPrintSheet() {
  const { request, receipt, status, sheetOpen, closeSheet, dismiss } = useReceiptPrint();
  const open = !!request && sheetOpen;
  const isPrelim = request?.type === 'preliminary';
  const title = isPrelim ? 'Печать счёта' : 'Печать чека';

  const primaryClose = () => {
    if (status === 'pending') closeSheet();
    else dismiss();
  };

  if (!request) return null;

  return (
    <BottomSheet
      visible={open}
      onClose={primaryClose}
      sheet
      title={title}
      maxHeight="80%"
      footer={
        <View style={{ paddingBottom: spacing.sm }}>
          {status === 'pending' ? (
            <Button title="Продолжить работу" variant="secondary" onPress={closeSheet} />
          ) : status === 'printed' ? (
            <Button title="Готово" onPress={dismiss} />
          ) : (
            <Button title="Продолжить работу" variant="secondary" onPress={dismiss} />
          )}
        </View>
      }
    >
      {status === 'pending' ? (
        <WaitingState isPrelim={isPrelim} />
      ) : status === 'printed' ? (
        <PrintedState isPrelim={isPrelim} />
      ) : (
        <RejectedState isPrelim={isPrelim} />
      )}
      {status === 'pending' && receipt ? <ReceiptCard /> : null}
    </BottomSheet>
  );
}

function WaitingState({ isPrelim }: { isPrelim: boolean }) {
  return (
    <View style={styles.centerState}>
      <PrinterAnimation />
      <Text style={styles.waitText}>
        {isPrelim
          ? 'Ожидаем подтверждение печати счёта администратором'
          : 'Ожидаем подтверждение печати чека администратором'}
      </Text>
    </View>
  );
}

function PrintedState({ isPrelim }: { isPrelim: boolean }) {
  return (
    <View style={styles.finalState}>
      <AnimatedCheck color={colors.success} backgroundColor={colors.successSoft} icon="check" />
      <Text style={styles.finalTitle}>{isPrelim ? 'Ваш счёт распечатан' : 'Ваш чек распечатан'}</Text>
      <Text style={styles.finalText}>{isPrelim ? 'Заберите счёт' : 'Заберите чек'}</Text>
    </View>
  );
}

function RejectedState({ isPrelim }: { isPrelim: boolean }) {
  return (
    <View style={styles.finalState}>
      <AnimatedCheck color={colors.danger} backgroundColor={colors.dangerSoft} icon="close" />
      <Text style={styles.finalTitle}>{isPrelim ? 'Печать счёта отклонена' : 'Печать чека отклонена'}</Text>
      <Text style={styles.finalText}>Администратором</Text>
    </View>
  );
}

function AnimatedCheck({
  color,
  backgroundColor,
  icon,
}: {
  color: string;
  backgroundColor: string;
  icon: 'check' | 'close';
}) {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 450,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      style={[
        styles.resultIcon,
        {
          backgroundColor,
          opacity: progress,
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 0.6, 1],
                outputRange: [0.4, 1.12, 1],
              }),
            },
          ],
        },
      ]}
    >
      <PwaIcon name={icon} size={42} color={color} strokeWidth={2.5} />
    </Animated.View>
  );
}

function PrinterAnimation() {
  const feed = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(feed, {
        toValue: 1,
        duration: 1800,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [feed]);

  const translateY = feed.interpolate({ inputRange: [0, 1], outputRange: [-22, 14] });
  const opacity = feed.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] });

  return (
    <View style={styles.printerWrap}>
      <View style={styles.printerTopPaper} />
      <Animated.View style={[styles.receiptPaper, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.receiptLineStub} />
        <View style={[styles.receiptLineStub, { width: '66%' }]} />
        <View style={[styles.receiptLineStub, { width: '84%' }]} />
      </Animated.View>
      <View style={styles.printerBody}>
        <View style={styles.printerSlot} />
        <View style={styles.printerLed} />
      </View>
    </View>
  );
}

function ReceiptCard() {
  const receipt = useReceiptPrint((state) => state.receipt);
  if (!receipt) return null;
  return (
    <View style={styles.receiptCard}>
      <View style={styles.receiptHead}>
        <Text style={styles.receiptOrder}>{displayOrderNumber(receipt.orderNumber)}</Text>
        <Text style={styles.receiptTable}>Стол {receipt.tableNumber}</Text>
      </View>
      <View style={styles.receiptItems}>
        {receipt.items.map((item, index) => (
          <View key={`${item.dishNameSnapshot}-${index}`} style={styles.receiptItem}>
            <Text style={styles.receiptItemName} numberOfLines={1}>
              {orderItemDisplayName(item)} <Text style={styles.receiptQty}>×{item.quantity}</Text>
            </Text>
            <Text style={styles.receiptItemPrice}>{money(item.finalPrice)}</Text>
          </View>
        ))}
      </View>
      {Number(receipt.serviceChargeAmount) > 0 ? (
        <View style={styles.receiptRow}>
          <Text style={styles.receiptRowLabel}>Обслуживание</Text>
          <Text style={styles.receiptRowValue}>{money(receipt.serviceChargeAmount)}</Text>
        </View>
      ) : null}
      <View style={styles.receiptTotal}>
        <Text style={styles.receiptTotalLabel}>Итого</Text>
        <Text style={styles.receiptTotalValue}>{money(receipt.finalAmount)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerState: { alignItems: 'center', paddingTop: spacing.sm },
  waitText: {
    marginTop: spacing.sm,
    maxWidth: 280,
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  finalState: { alignItems: 'center', paddingVertical: spacing.lg },
  resultIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finalTitle: { marginTop: spacing.lg, fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  finalText: { marginTop: 4, fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  printerWrap: { width: 112, height: 104, marginTop: 4 },
  printerTopPaper: {
    position: 'absolute',
    top: 0,
    left: 32,
    width: 48,
    height: 12,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  receiptPaper: {
    position: 'absolute',
    top: 42,
    left: 26,
    width: 60,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    backgroundColor: colors.white,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 5,
  },
  receiptLineStub: { height: 3, width: '100%', borderRadius: 2, backgroundColor: colors.slate300 },
  printerBody: {
    position: 'absolute',
    zIndex: 1,
    top: 12,
    left: 8,
    width: 96,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.slate100,
  },
  printerSlot: {
    position: 'absolute',
    bottom: 6,
    left: 16,
    width: 64,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.slate300,
  },
  printerLed: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  receiptCard: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  receiptHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  receiptOrder: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  receiptTable: { fontSize: fontSize.sm, color: colors.textMuted },
  receiptItems: { gap: 4, marginTop: spacing.sm },
  receiptItem: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  receiptItemName: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  receiptQty: { color: colors.textLight },
  receiptItemPrice: { fontSize: fontSize.sm, color: colors.textPrimary },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  receiptRowLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  receiptRowValue: { fontSize: fontSize.sm, color: colors.textPrimary },
  receiptTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  receiptTotalLabel: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  receiptTotalValue: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
});
