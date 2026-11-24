import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheet, SheetFlatList, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button } from '@/components/ui';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { apiError } from '@/lib/api';
import { shareCsv } from '@/screens/admin/print';
import { WarehouseMultiSelect } from '@/screens/admin/WarehouseMultiSelect';
import { useNotifications } from '@/store/notifications';
import { colors, fontSize, spacing } from '@/theme';
import type { AccountType, CashFlow, FinanceData } from './api';
import { buildCashFlowTable, flowCell, type FlowColumn, type FlowLine, type FlowMovement } from './cash-flow-table';
import { FinanceLine, financeStyles } from './components';
import { financeDateTime, financeMoney } from './format';
import { choice } from './rules';

const optionTypes: { type: AccountType; label: string }[] = [{ type: 'cash', label: 'нал.' }, { type: 'noncash', label: 'безнал.' }];
type CashFlowColumn = 'amounts' | 'percent';
const defaults: CashFlowColumn[] = [];
const columnOptions: { value: CashFlowColumn; label: string }[] = [
  { value: 'amounts', label: 'Суммы по типам счетов' }, { value: 'percent', label: 'Доли по типам счетов' },
];
const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 });

function visibleLines(lines: FlowLine[], expanded: string[] | null, path = '', depth = 0): { line: FlowLine; id: string; depth: number }[] {
  return lines.flatMap((line) => {
    const id = path + '/' + line.id;
    return [{ line, id, depth },
      ...(!expanded || expanded.includes(id) ? visibleLines(line.children ?? [], expanded, id, depth + 1) : [])];
  });
}

export function CashFlowRegister({ data, flow, from, to, accounts, onAccounts, allowExport }: {
  data: FinanceData;
  flow: CashFlow;
  from: string;
  to: string;
  accounts: string[];
  onAccounts: (value: string[]) => void;
  allowExport: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ title: string; rows: FlowMovement[] }>();
  const [columns, saveColumns] = useColumnPreference<CashFlowColumn>('finance-cash-flow', defaults);
  const [exporting, setExporting] = useState(false);
  const notify = useNotifications((state) => state.push);
  const included = useMemo(() => accounts.length ? data.accounts.filter(({ id }) => accounts.includes(id)) : data.accounts, [accounts, data.accounts]);
  const { periods, lines, byAccount } = useMemo(() => buildCashFlowTable(flow, included, data.categories, data.entries, from, to),
    [flow, included, data.categories, data.entries, from, to]);
  const showAmounts = columns.includes('amounts');
  const showPercent = columns.includes('percent');
  const sheetColumns = periods.flatMap((period): FlowColumn[] => [
    { id: period.key, label: showAmounts || showPercent ? period.shortLabel + ', всего' : period.label, period },
    ...(showAmounts ? optionTypes.map(({ label, type }) => ({ id: period.key + ':' + type, label: period.shortLabel + ', ' + label, period, type })) : []),
    ...(showPercent ? optionTypes.map(({ label, type }) => ({ id: period.key + ':' + type + ':%', label: period.shortLabel + ', ' + label + ' %', period, type, percent: true })) : []),
  ]);

  function display(line: FlowLine, column: FlowColumn, cents: number) {
    if (!column.percent) return financeMoney(cents / 100);
    const total = flowCell(line, { ...column, type: undefined }, byAccount).cents;
    return total ? percentFormat.format(cents / total) : '—';
  }

  async function exportFlow() {
    setExporting(true);
    try {
      await shareCsv('Движение денег ' + from + ' — ' + to, [
        ['Статья', ...sheetColumns.map(({ label }) => label)],
        ...visibleLines(lines, null).map(({ line, depth }) => [
          '  '.repeat(depth) + (/^\s*[=+@\-]/.test(line.label) ? "'" : '') + line.label,
          ...sheetColumns.map((column) => {
            const { cents } = flowCell(line, column, byAccount);
            return column.percent ? display(line, column, cents) : cents / 100;
          }),
        ]),
      ]);
    } catch (error) {
      notify({ message: apiError(error), type: 'error', at: new Date().toISOString() });
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={financeStyles.stack}>
      <View style={financeStyles.toolbar}>
        <WarehouseMultiSelect label="Счета" value={accounts} onChange={onAccounts} options={data.accounts.map(choice)} />
        <WarehouseMultiSelect label="Столбцы" value={columns} onChange={saveColumns} options={columnOptions} />
        {allowExport ? <Button icon="export" title="Экспорт" size="md" variant="secondary" loading={exporting} onPress={() => void exportFlow()} /> : null}
      </View>
      <View style={financeStyles.card}>
        <SheetScrollView horizontal>
          <View>
            <View style={styles.row}>
              <Text style={[styles.label, financeStyles.muted]} translate>Статья</Text>
              {sheetColumns.map(({ id, label }) => <Text key={id} style={[styles.cell, financeStyles.muted]} translate>{label}</Text>)}
            </View>
            {visibleLines(lines, expanded).map(({ line, id, depth }) => (
              <View key={id} style={styles.row}>
                <FastPressable accessibilityRole="button" accessibilityState={{ expanded: expanded.includes(id) }}
                  disabled={!line.children?.length} style={[styles.label, { paddingLeft: spacing.xs + depth * spacing.md }]}
                  onPress={() => setExpanded((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id])}>
                  {line.children?.length ? <PwaIcon name={expanded.includes(id) ? 'chevronDown' : 'chevronRight'} size={14} color={colors.textMuted} /> : null}
                  <Text numberOfLines={2} style={[styles.title, depth === 0 && financeStyles.label]} translate={depth === 0}>{line.label}</Text>
                </FastPressable>
                {sheetColumns.map((column) => {
                  const cell = flowCell(line, column, byAccount);
                  const value = display(line, column, cell.cents);
                  return <FastPressable accessibilityRole="button" key={column.id} disabled={!cell.movements.length}
                    style={styles.cell} onPress={() => setDetail({ title: line.label + ' · ' + column.label, rows: cell.movements })}>
                    <Text style={[styles.amount, cell.movements.length > 0 && styles.drilldown]}>{value}</Text>
                  </FastPressable>;
                })}
              </View>
            ))}
          </View>
        </SheetScrollView>
      </View>
      <BottomSheet visible={!!detail} title={detail?.title} onClose={() => setDetail(undefined)} maxHeight="92%">
        <SheetFlatList data={detail?.rows ?? []} keyExtractor={({ id }) => id}
          contentContainerStyle={financeStyles.body}
          renderItem={({ item }) => <View style={financeStyles.card}>
            <FinanceLine label={item.category} value={financeMoney(item.cents / 100)} />
            <Text style={financeStyles.muted}>{financeDateTime(item.at)} · {byAccount.get(item.accountId)?.name ?? '—'}</Text>
            {item.note !== '—' ? <Text style={financeStyles.muted}>{item.note}</Text> : null}
          </View>} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, minHeight: 44 },
  label: { width: 202, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  title: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
  cell: { width: 116, textAlign: 'right', padding: spacing.sm },
  amount: { textAlign: 'right', color: colors.textSecondary, fontSize: fontSize.sm },
  drilldown: { color: colors.primary },
});
