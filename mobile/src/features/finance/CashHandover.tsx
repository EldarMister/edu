import { useState } from 'react';
import { isAxiosError } from 'axios';
import { printAsync } from 'expo-print';
import { Select } from '@/components/Select';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, EmptyState, Loading } from '@/components/ui';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { apiError } from '@/lib/api';
import type { CashHandoverFilter } from '@/navigation/adminWorkspaceNavigation';
import { useNotifications } from '@/store/notifications';
import { colors } from '@/theme';
import { shareCsv } from '@/screens/admin/print';
import { WarehouseDirectoryLink, WarehouseDirectoryTable, WarehouseDirectoryValue } from '@/screens/admin/WarehouseDirectoryTable';
import { WarehouseMultiSelect } from '@/screens/admin/WarehouseMultiSelect';
import { useCashHandover, useCashHandoverWrites, type CashHandoverRow } from './api';
import { DateRange, FinanceForm, FinanceLine, FinanceQueryError, MoneyField, SwitchField, financeStyles } from './components';
import { financeDateTime, financeDay, financeMoney, parseMoney } from './format';

const staffColumns = [
  { key: 'date', label: 'Дата продажи', width: 128 },
  { key: 'employee', label: 'Сотрудник', width: 156 },
  { key: 'due', label: 'К сдаче', width: 106 },
  { key: 'received', label: 'Сдал', width: 106 },
  { key: 'difference', label: 'Разница', width: 106 },
  { key: 'receivedAt', label: 'Принято / уточнено', width: 160 },
] as const;

const dailyColumns = [
  { key: 'date', label: 'Дата поступления', width: 155 },
  { key: 'received', label: 'Поступило с учётом уточнений', width: 173 },
] as const;

type ColumnKey = typeof staffColumns[number]['key'];
type CellValue = string | number | null;
type ReportRow = { id: string; values: Partial<Record<ColumnKey, CellValue>>; source?: CashHandoverRow };
const moneyKeys = new Set<ColumnKey>(['due', 'received', 'difference']);
const toDateLabel = (date: string) => date.split('-').reverse().join('.');
const sumMoney = (amounts: number[]) => amounts.reduce((cents, amount) => cents + Math.round(amount * 100), 0) / 100;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char] ?? char);

function display(key: ColumnKey, value: CellValue | undefined) {
  if (moneyKeys.has(key)) {
    return (key === 'difference' && typeof value === 'number' && value > 0 ? '+' : '')
      + financeMoney(typeof value === 'number' ? value : null);
  }
  return value == null ? '—' : String(value);
}

export function CashHandoverRegister({ initialFilter, allowExport }: {
  initialFilter?: CashHandoverFilter;
  allowExport: boolean;
}) {
  const today = financeDay();
  const [from, setFrom] = useState(initialFilter?.date ?? today.slice(0, 7) + '-01');
  const [to, setTo] = useState(initialFilter?.date ?? today);
  const [employee, setEmployee] = useState(initialFilter?.employeeId ?? '');
  const [daily, setDaily] = useState(false);
  const [selected, setSelected] = useState<CashHandoverRow | null>(null);
  const [outputAction, setOutputAction] = useState<'csv' | 'print' | null>(null);
  const [staffPreference, saveStaffPreference] = useColumnPreference<ColumnKey>('finance-handover-staff', staffColumns.map(({ key }) => key));
  const [dailyPreference, saveDailyPreference] = useColumnPreference<ColumnKey>('finance-handover-days', dailyColumns.map(({ key }) => key));
  const push = useNotifications((state) => state.push);
  const valid = Boolean(from && to && from <= to && to <= today);
  const report = useCashHandover(from, to, valid);
  const { setEnabled } = useCashHandoverWrites();
  const period = <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />;
  if (!valid) return <>{period}<Text style={financeStyles.error} translate>Укажите корректный период</Text></>;
  if (report.isPending) return <>{period}<Loading /></>;
  if (report.isError || !report.data) {
    const unavailable = isAxiosError(report.error) && report.error.response?.status === 404;
    return <>{period}{unavailable ? <EmptyState text="Раздел появится после обновления сервера" />
      : <FinanceQueryError error={report.error} retry={() => void report.refetch()} />}</>;
  }

  const data = report.data;
  const names = [...new Map(data.rows.map(({ employeeId, employee: label }) => [employeeId, label]))]
    .map(([value, label]) => ({ value, label, translate: false }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  const staffRows = data.rows.filter(({ employeeId }) => !employee || employee === employeeId);
  const title = daily ? 'Поступления наличных по дням' : 'Сдача наличных';
  const specs = daily ? dailyColumns : staffColumns;
  const preference = daily ? dailyPreference : staffPreference;
  const savePreference = daily ? saveDailyPreference : saveStaffPreference;
  const active = specs.filter(({ key }) => preference.includes(key));
  const columns = active.length ? active : specs;

  const rows: ReportRow[] = daily ? data.daily.map(({ date, amount }) => ({
    id: date, values: { date: toDateLabel(date), received: amount },
  })) : staffRows.map((row) => ({
    id: row.id, source: row, values: {
      date: toDateLabel(row.date), employee: row.employee, due: row.due, received: row.received, difference: row.difference,
      receivedAt: row.receivedAt ? financeDateTime(row.receivedAt) : row.due ? 'Ожидает сдачи' : 'Нет суммы к сдаче',
    },
  }));
  const totals: ReportRow = daily ? { id: 'total', values: { date: 'Итого', received: sumMoney(data.daily.map(({ amount }) => amount)) } }
    : { id: 'total', values: { date: 'Итого', due: sumMoney(staffRows.map(({ due }) => due)),
      received: sumMoney(staffRows.map(({ received }) => received ?? 0)), difference: sumMoney(staffRows.map(({ difference }) => difference)) } };

  async function output(action: 'csv' | 'print') {
    setOutputAction(action);
    try {
      const header = columns.map(({ label }) => label);
      const body = [...rows, totals].map(({ values }) => columns.map(({ key }) => values[key] ?? null));
      if (action === 'csv') {
        await shareCsv(title, [header, ...body.map((row) => row.map((value) =>
          typeof value === 'string' && /^[=+@-]/.test(value.trimStart()) ? "'" + value : value))]);
      } else {
        const table = '<table border="1" cellspacing="0" cellpadding="6"><thead><tr>'
          + header.map((label) => '<th>' + escapeHtml(label) + '</th>').join('') + '</tr></thead><tbody>'
          + body.map((row) => '<tr>' + row.map((value, index) => '<td>'
            + escapeHtml(display(columns[index].key, value)) + '</td>').join('') + '</tr>').join('')
          + '</tbody></table>';
        await printAsync({ html: '<meta charset="utf-8"><h1>' + title + '</h1>' + table });
      }
    } catch (error) {
      push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
    } finally {
      setOutputAction(null);
    }
  }

  return <>
    <View style={financeStyles.card}>
      {data.canConfigure
        ? <SwitchField label="Принимать наличные от официантов вручную" checked={data.enabled} disabled={setEnabled.isPending}
          onChange={(enabled) => setEnabled.mutate(enabled)} />
        : <FinanceLine label="Принимать наличные от официантов вручную" value={data.enabled ? 'Включено владельцем' : 'Выключено'} />}
      <Text style={financeStyles.muted} translate>При включённом режиме наличные по новым чекам официантов поступают в кассу после подтверждения сдачи.</Text>
      {setEnabled.isError ? <Text accessibilityRole="alert" style={financeStyles.error}>{apiError(setEnabled.error)}</Text> : null}
    </View>
    <View style={financeStyles.toolbar}>
      <Button title="По сотрудникам" size="md" variant={daily ? 'secondary' : 'primary'} onPress={() => setDaily(false)} />
      <Button title="По дням приёма" size="md" variant={daily ? 'primary' : 'secondary'} onPress={() => setDaily(true)} />
    </View>
    {period}
    <View style={financeStyles.toolbar}>
      {!daily ? <Select title="Сотрудник" value={employee} onChange={setEmployee} searchable={names.length > 8}
        options={[{ value: '', label: 'Все сотрудники' }, ...names,
          ...(employee && !names.some(({ value }) => value === employee) ? [{ value: employee, label: 'Выбранный сотрудник' }] : [])]} /> : null}
      <WarehouseMultiSelect label="Столбцы" value={preference} onChange={(keys) => { if (keys.length) savePreference(keys); }}
        options={specs.map(({ key, label }) => ({ value: key, label }))} />
      {allowExport ? <>
        <Button title="Экспорт" variant="secondary" size="md" disabled={!rows.length || !!outputAction} onPress={() => void output('csv')} />
        <Button title="Печать" variant="secondary" size="md" disabled={!rows.length || !!outputAction} onPress={() => void output('print')} />
      </> : null}
    </View>
    {rows.length === 0 ? <EmptyState text={daily ? 'За этот период сдачу наличных не проводили' : 'За этот период нет наличных к сдаче'} />
      : <WarehouseDirectoryTable rows={[...rows, totals]} columns={[
        ...columns.map(({ key, label, width }) => ({ key, title: label, width, cell: (row: ReportRow) => {
          const value = row.values[key];
          return key === 'difference' && typeof value === 'number' && value < 0
            ? <Text style={{ color: colors.danger }}>{display(key, value)}</Text>
            : <WarehouseDirectoryValue>{display(key, value)}</WarehouseDirectoryValue>;
        } })),
        ...(!daily && data.canReceive ? [{
          key: 'actions', title: 'Действия', width: 110,
          cell: ({ source }: ReportRow) => source ? <WarehouseDirectoryLink
            label={source.received === null ? 'Принять' : 'Уточнить'} onPress={() => setSelected(source)} translate /> : null,
        }] : []),
      ]} />}
    {selected ? <ReceiveCashForm row={selected} onClose={() => setSelected(null)} /> : null}
  </>;
}

function ReceiveCashForm({ row, onClose }: { row: CashHandoverRow; onClose: () => void }) {
  const [value, setValue] = useState(row.received?.toString() ?? '');
  const { receive } = useCashHandoverWrites();
  const amount = parseMoney(value);
  return <FinanceForm title={row.received === null ? 'Принять наличные' : 'Уточнить сдачу наличных'} onClose={onClose}
    submitLabel="Подтвердить сдачу" disabled={amount === null || amount < 0 || amount > 99_999_999.99}
    submit={async () => {
      if (amount !== null) await receive.mutateAsync({
        employeeId: row.employeeId, date: row.date, amount, expectedReceivedAt: row.receivedAt ?? undefined,
      });
    }}>
    <Text style={financeStyles.heading}>{row.employee} · {toDateLabel(row.date)}</Text>
    <FinanceLine label="К сдаче" value={financeMoney(row.due)} />
    <MoneyField label="Фактически сдал за день" value={value} onChange={setValue} />
    {row.received !== null ? <Text style={financeStyles.muted}>{'Ранее принято ' + financeMoney(row.received) + '. В кассе отразится разница.'}</Text> : null}
  </FinanceForm>;
}
