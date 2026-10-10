import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import * as DocumentPicker from 'expo-document-picker';
import { Button, Card, Field } from '@/components/ui';
import { DateField } from '@/components/DateField';
import { Select } from '@/components/Select';
import { colors, spacing } from '@/theme';
import { displayOrderNumber, money, paymentMethodLabel } from '@/utils/format';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { usePermissions } from '@/hooks/usePermissions';
import { type ReconResult, type ReconStatus, useReconcilePayments } from '@/services/api/admin';
import { shareCsv } from './print';

const STATUS: Record<ReconStatus, string> = { matched: 'Совпало', not_found: 'Не найдено', needs_review: 'Требует проверки', amount_mismatch: 'Сумма отличается', extra: 'Лишняя операция' };
const date = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const time = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const diff = (seconds: number | null) => seconds == null ? '—' : `${Math.floor(Math.abs(seconds) / 60)} мин ${Math.abs(seconds) % 60} сек`;

export function ReconciliationScreen() {
  const [from, setFrom] = useState(() => date(-6));
  const [to, setTo] = useState(() => date());
  const [tolerance, setTolerance] = useState('3');
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [result, setResult] = useState<ReconResult | null>(null);
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const reconcile = useReconcilePayments();
  const push = useNotifications((s) => s.push);
  const { canAction } = usePermissions();
  const stats = useMemo(() => result ? [['Оплат в POS', result.stats.paidCount], ['Найдено в банке', result.stats.matched], ['Не найдено', result.stats.notFound], ['Требует проверки', result.stats.needsReview], ['Расхождения', result.stats.amountMismatch]] : [], [result]);
  const rows = (result?.rows ?? []).filter((row) => !status || row.status === status);
  const reportError = (error: unknown) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
  async function pick() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], copyToCacheDirectory: true });
      if (!r.canceled) { if ((r.assets[0].size ?? 0) > 15 * 1024 * 1024) throw new Error('Файл должен быть меньше 15 МБ'); setFile(r.assets[0]); }
    } catch (error) { reportError(error); }
  }
  async function submit() {
    if (!file) return;
    const toleranceMin = Number(tolerance.replace(',', '.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to || to > date() || !Number.isFinite(toleranceMin) || toleranceMin < 0 || toleranceMin > 60) { reportError(new Error('Проверьте период и допустимое расхождение времени (0–60 мин)')); return; }
    try { setResult(await reconcile.mutateAsync({ uri: file.uri, name: file.name, mimeType: file.mimeType, from, to, toleranceMin })); }
    catch (error) { reportError(error); }
  }
  async function exportReport() {
    setExporting(true);
    try { await shareCsv(`reconciliation-${from}-${to}`, [['№ заказа', 'Дата и время заказа', 'Сумма POS', 'Сумма банка', 'Время операции', 'Разница секунд', 'Оплата', 'Официант', 'Статус', 'Комментарий'], ...rows.map((row) => [row.orderNumber, row.orderTime, row.posAmount, row.bankAmount, row.bankTime, row.timeDiffSec, row.paymentMethod, row.waiter, STATUS[row.status], row.comment])]); }
    catch (error) { reportError(error); }
    finally { setExporting(false); }
  }
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <Card style={styles.stack}>
      <View style={styles.dates}><View style={{ flex: 1 }}><DateField label="С даты" value={from} onChangeText={setFrom} maximumDate={new Date()} /></View><View style={{ flex: 1 }}><DateField label="По дату" value={to} onChangeText={setTo} maximumDate={new Date()} /></View></View>
      <Field label="Допустимая разница времени, мин" value={tolerance} onChangeText={setTolerance} keyboardType="decimal-pad" />
      <Button title={file ? 'Заменить выписку' : 'Загрузить выписку'} variant="secondary" onPress={() => void pick()} />
      <Text style={styles.muted} translate>{file ? `Файл: ${file.name}` : 'Поддерживаются PDF, XLS, XLSX, CSV.'}</Text>
      <Text style={styles.muted} translate>Сверяются безналичные оплаты (QR и карта). Файл выписки не сохраняется.</Text>
      <Button title="Начать сверку" loading={reconcile.isPending} disabled={!file} onPress={() => void submit()} />
    </Card>
    {!result ? <Card><Text style={styles.title} translate>Загрузите банковскую выписку</Text><Text style={styles.muted} translate>Система сопоставит оплаты POS с операциями из выписки по сумме и времени.</Text></Card> : <>
      <View style={styles.stats}>{stats.map(([label, value]) => <Card key={String(label)} style={styles.stat}><Text style={styles.muted} translate>{label}</Text><Text style={styles.statValue}>{value}</Text></Card>)}</View>
      <Select value={status} onChange={setStatus} options={[{ value: '', label: 'Все результаты' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} title="Статус сверки" />
      {canAction('exportReports') ? <Button title="Экспорт результатов CSV" variant="secondary" loading={exporting} onPress={() => void exportReport()} /> : null}
      {rows.length === 0 ? <Text style={styles.muted} translate>Совпадений и расхождений не найдено</Text> : rows.map((row, i) => <Card key={`${row.orderId ?? 'bank'}-${i}`} style={styles.stack}>
        <View style={styles.between}><Text style={styles.title} translate>{row.orderNumber ? `Заказ ${displayOrderNumber(row.orderNumber)}` : 'Операция банка'}</Text><Text style={[styles.status, { color: row.status === 'matched' ? colors.success : row.status === 'amount_mismatch' ? colors.danger : colors.warning }]}>{STATUS[row.status]}</Text></View>
        <Info label="Дата и время заказа" value={time(row.orderTime)} /><Info label="Сумма POS" value={row.posAmount == null ? '—' : money(row.posAmount)} /><Info label="Сумма в банке" value={row.bankAmount == null ? '—' : money(row.bankAmount)} /><Info label="Время операции" value={time(row.bankTime)} /><Info label="Разница" value={diff(row.timeDiffSec)} /><Info label="Оплата" value={row.paymentMethod ? paymentMethodLabel(row.paymentMethod) : '—'} /><Info label="Официант" value={row.waiter ?? '—'} />{row.comment ? <Text style={styles.muted}>{row.comment}</Text> : null}
      </Card>)}
    </>}
  </ScrollView>;
}

function Info({ label, value }: { label: string; value: string }) { return <View style={styles.between}><Text style={styles.muted} translate>{label}</Text><Text style={styles.value}>{value}</Text></View>; }
const styles = StyleSheet.create({ content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }, stack: { gap: spacing.sm }, title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary }, dates: { flexDirection: 'row', gap: spacing.sm }, muted: { color: colors.textMuted, fontSize: 13, lineHeight: 18 }, stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, stat: { width: '48%', minHeight: 84 }, statValue: { color: colors.textPrimary, fontSize: 25, fontWeight: '700', marginTop: 4 }, between: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }, value: { flex: 1, textAlign: 'right', color: colors.textPrimary, fontWeight: '500', fontSize: 13 }, status: { maxWidth: 110, textAlign: 'right', fontSize: 12, fontWeight: '600' } });
