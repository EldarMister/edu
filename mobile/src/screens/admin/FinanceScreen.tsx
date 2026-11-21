import { useState } from 'react';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Select } from '@/components/Select';
import { SheetScrollView } from '@/components/BottomSheet';
import { EmptyState, Loading } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { CashFlowRegister } from '@/features/finance/CashFlow';
import { CashShiftRegister } from '@/features/finance/CashShifts';
import { CashHandoverRegister } from '@/features/finance/CashHandover';
import { PayrollRegister } from '@/features/finance/Payroll';
import { AccountDirectory, CategoryDirectory, TransactionRegister } from '@/features/finance/Registers';
import { useFinance } from '@/features/finance/api';
import { DateRange, FinanceQueryError, financeStyles } from '@/features/finance/components';
import { financeDay } from '@/features/finance/format';
import { spacing } from '@/theme';

import type { CashHandoverFilter, FinanceView } from '@/navigation/adminWorkspaceNavigation';

const periods = [
  { value: 'all', label: 'За всё время' }, { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }, { value: 'custom', label: 'Другой период' },
];

function periodStart(today: string, period: string) {
  if (period === 'today') return today;
  if (period === 'month') return today.slice(0, 7) + '-01';
  if (period === 'week') {
    const start = new Date(today + 'T12:00:00+06:00');
    start.setUTCDate(start.getUTCDate() - 6);
    return financeDay(start);
  }
}

export function FinanceScreen({ view, handover }: { view: FinanceView; handover?: CashHandoverFilter }) {
  const { canAction, canSection, canEditSection } = usePermissions();
  const canViewShifts = canSection('finance') || canAction('financeCashShifts');
  const canManageShifts = canSection('finance') ? canEditSection('finance') : canAction('financeCashShifts');
  return (
    <SheetScrollView key={view} style={financeStyles.page} contentContainerStyle={[financeStyles.body, { padding: spacing.md }]}
      keyboardShouldPersistTaps="handled">
      {view === 'cashShifts' ? (
        canViewShifts ? <CashShiftRegister canManage={canManageShifts} /> : <EmptyState text="Нет доступа к кассовым сменам" />
      ) : view === 'cashHandover' ? (
        <CashHandoverRegister key={handover ? handover.date + ':' + handover.employeeId : 'all'} initialFilter={handover}
          allowExport={canAction('exportReports') || canEditSection('finance')} />
      ) : <FinanceOverview view={view} allowExport={canAction('exportReports') || canEditSection('finance')} />}
    </SheetScrollView>
  );
}

function FinanceOverview({ view, allowExport }: { view: Exclude<FinanceView, 'cashShifts' | 'cashHandover'>; allowExport: boolean }) {
  const today = financeDay();
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [flowAccounts, setFlowAccounts] = useState<string[]>([]);
  const transactionStart = periodStart(today, period);
  const ranged = view === 'cashFlow' || (view === 'transactions' && period === 'custom');
  const rangeValid = !ranged || (!!from && !!to && from <= to && to <= today);
  const finance = useFinance({
    from: ranged ? from : view === 'transactions' ? transactionStart : undefined,
    to: ranged ? to : view === 'transactions' && transactionStart ? today : undefined,
    accountIds: view === 'cashFlow' && flowAccounts.length ? flowAccounts.join(',') : undefined,
  }, rangeValid);
  const dates = <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />;
  const selectedPeriod = view === 'transactions' ? (
    <View style={financeStyles.stack}>
      <Select title="Период" value={period} options={periods} onChange={setPeriod} />
      {period === 'custom' ? dates : null}
    </View>
  ) : view === 'cashFlow' ? dates : null;
  return (
    <>
      {selectedPeriod}
      {!rangeValid ? <Text style={financeStyles.error} translate>Укажите корректный период</Text>
        : finance.isPending ? <Loading />
        : finance.isError ? <FinanceQueryError error={finance.error} retry={() => void finance.refetch()} />
        : view === 'payroll' ? <PayrollRegister data={finance.data} />
        : view === 'accounts' ? <AccountDirectory data={finance.data} />
        : view === 'categories' ? <CategoryDirectory data={finance.data} />
        : view === 'cashFlow' ? finance.data.flow ? (
          <CashFlowRegister data={finance.data} flow={finance.data.flow} from={from} to={to} accounts={flowAccounts}
            onAccounts={setFlowAccounts} allowExport={allowExport} />
        ) : <EmptyState text="Нет доступа к движению денег" />
        : <TransactionRegister data={finance.data} allowExport={allowExport} />}
    </>
  );
}
