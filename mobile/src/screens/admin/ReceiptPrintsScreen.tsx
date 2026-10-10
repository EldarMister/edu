import React, { useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Alert, Text } from '@/components/typography';
import { Button, Card } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { api, apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useAdminOrderDetails, useFiscalizeForPrint, useReceiptPrintActions, useReceiptPrintRequests } from '@/services/api/admin';
import { usePublicSettings } from '@/services/api/settings';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import { colors, spacing } from '@/theme';
import type { Receipt, ReceiptPrintRequest } from '@/types';
import { OrderDetailsModal } from './OrderDetailsModal';
import { printNativeReceipt } from './print';

export function ReceiptPrintsScreen({ initialOrderId }: { initialOrderId?: string } = {}) {
  const q = useReceiptPrintRequests();
  const { approve, reject, printed } = useReceiptPrintActions();
  const fiscalize = useFiscalizeForPrint();
  const settings = usePublicSettings();
  const push = useNotifications((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const printAbort = useRef<AbortController | null>(null);
  React.useEffect(() => () => printAbort.current?.abort(), []);
  const [orderId, setOrderId] = useState<string | null>(initialOrderId ?? null);
  React.useEffect(() => { if (initialOrderId) setOrderId(initialOrderId); }, [initialOrderId]);
  const detail = useAdminOrderDetails(orderId);
  const notify = (message: string, type: 'success' | 'error') => push({ message, type, at: new Date().toISOString() });

  async function print(row: ReceiptPrintRequest) {
    if (running.current) return;
    running.current = true;
    setBusy(row.id);
    const controller = new AbortController();
    printAbort.current = controller;
    try {
      const request = row.source !== 'order';
      if (request && row.status !== 'approved') await approve.mutateAsync(row.id);
      const receipt = (await api.get<Receipt>(`/payments/${row.orderId}/receipt`)).data;
      let fiscal = null;
      if (row.type !== 'preliminary' && settings.data?.fiscalEnabled) {
        try { fiscal = await fiscalize.mutateAsync(row.orderId); if (fiscal?.error) notify(`Ошибка ККМ: ${fiscal.error}`, 'error'); }
        catch (error) { notify(`ККМ недоступна: ${apiError(error)}`, 'error'); }
      }
      await printNativeReceipt(receipt, row.type === 'preliminary', fiscal, controller.signal);
      if (controller.signal.aborted) return;
      if (request && Platform.OS === 'android') {
        const confirmed = await new Promise<boolean>((resolve) => Alert.alert('Чек распечатан?', 'Подтвердите печать после завершения системного окна. При отмене заявку можно распечатать снова.', [{ text: 'Пока нет', style: 'cancel', onPress: () => resolve(false) }, { text: 'Распечатан', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
        if (!confirmed || controller.signal.aborted) return;
      }
      if (request) await printed.mutateAsync(row.id);
      notify(`${row.type === 'preliminary' ? 'Счёт' : 'Чек'} ${displayOrderNumber(row.orderNumber)} отправлен на печать`, 'success');
    } catch (error) { if (!controller.signal.aborted) notify(apiError(error), 'error'); }
    finally { printAbort.current = null; running.current = false; setBusy(null); }
  }

  async function rejectRequest(row: ReceiptPrintRequest) {
    if (running.current) return;
    running.current = true;
    setBusy(row.id);
    try { await reject.mutateAsync(row.id); notify('Заявка отклонена', 'success'); }
    catch (error) { notify(apiError(error), 'error'); }
    finally { running.current = false; setBusy(null); }
  }

  const section = (title: string, rows: ReceiptPrintRequest[], empty: string) => <Card style={styles.section}><Text style={styles.title} translate>{title}</Text>{rows.length === 0 ? <Text style={styles.muted}>{empty}</Text> : rows.map((row) => <View key={row.id} style={styles.row}><FastPressable onPress={() => setOrderId(row.orderId)} style={{ gap: 4 }}><View style={styles.between}><Text style={styles.name} translate>{displayOrderNumber(row.orderNumber)} · {row.type === 'preliminary' ? 'Счёт' : 'Чек'}</Text><Text style={styles.name}>{money(row.amount)}</Text></View><Text style={styles.muted} translate>Стол {row.tableNumber} · {row.waiterName} · {timeHM(row.createdAt)}</Text></FastPressable><View style={styles.actions}><Button title={row.source !== 'order' && row.status !== 'approved' ? 'Принять и печатать' : 'Печать'} size="md" loading={busy === row.id} disabled={!!busy} onPress={() => void print(row)} style={{ flex: 1 }} />{row.source !== 'order' ? <Button title="Отклонить" variant="danger" size="md" disabled={!!busy} onPress={() => void rejectRequest(row)} /> : null}</View></View>)}</Card>;
  return <><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.primary} />}>{q.isLoading ? <ActivityIndicator color={colors.primary} /> : q.isError ? <Card><Text style={{ color: colors.danger }}>{apiError(q.error)}</Text><Button title="Повторить" onPress={() => void q.refetch()} /></Card> : <>{section('Запрошенные на печать', (q.data ?? []).filter((row) => row.source !== 'order'), 'Запросов на печать нет')}{section('Доступные к печати', (q.data ?? []).filter((row) => row.source === 'order'), 'Доступных заказов к печати нет')}</>}</ScrollView><OrderDetailsModal order={detail.data ?? null} onClose={() => setOrderId(null)} /></>;
}

const styles = StyleSheet.create({ content: { padding: spacing.lg, gap: spacing.md }, section: { gap: spacing.md }, title: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 }, row: { paddingTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm }, between: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }, name: { fontWeight: '600', color: colors.textPrimary }, muted: { color: colors.textMuted, fontSize: 13 }, actions: { flexDirection: 'row', gap: spacing.sm } });
