import { useState } from 'react';
import { Select } from '@/components/Select';
import { EditorPage } from '../warehouse/EditorPage';
import type { EditorRoute } from '../warehouse/workspace-route';
import { usePayroll, type FinanceAccount, type PayrollPeriod, type PayrollReport, type PayrollStaffRow } from './api';
import { apiError } from '@/lib/api';
import { Spinner } from '@/components/Spinner';
import { FinanceTable } from './CashShiftsPage';
import { AccrualForm, PayoutForm } from './FinanceForms';
import { financeDateTime, financeMoney } from './finance-format';

export function payrollMonthLabel(month: string) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T00:00:00Z'));
}
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const commissionNumber = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const shortDay = (iso: string) => iso.split('-').reverse().join('.');

export function PayrollEmployeeCard({ employee, month, range, entries, accounts, canAccrue, canPay, onClose, openEditor }: {
  employee: PayrollStaffRow; month: string; entries: PayrollReport['records']; accounts: FinanceAccount[];
  range?: { from: string; to: string };
  canAccrue: boolean; canPay: boolean; onClose: () => void; openEditor: (editor: EditorRoute) => void;
}) {
  const [action, setAction] = useState('');
  const [showEvidence, setShowEvidence] = useState(false);
  const payable = entries.filter((entry) => !entry.voidedAt && entry.amount > entry.paidAmount);
  const primaryAccrual = canAccrue && employee.available > 0;
  return <EditorPage title={employee.name} onClose={onClose}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-secondary">{range ? shortDay(range.from) + ' — ' + shortDay(range.to) : payrollMonthLabel(month)} · {employee.position || 'Без должности'}</p>
        {canAccrue && <Select ariaLabel="Дополнительные действия с зарплатой" value="" placeholder="Другие действия"
          onChange={setAction} options={[{ value: 'bonus', label: 'Добавить премию или доплату' }, { value: 'manual', label: 'Начислить вручную' }]} />}
      </div>
      <dl className={`grid gap-px overflow-hidden rounded-lg border border-border bg-border ${range ? 'max-w-sm grid-cols-1' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {[
          ['Рассчитано', employee.estimate, 'По ставкам должности'], ['Начислено', employee.accrued, 'Подтверждено, включая доплаты'],
          ['Выплачено', employee.paid, 'Списано со счетов'], ['Остаток', employee.due, 'Ещё нужно выплатить'],
        ].slice(0, range ? 1 : 4).map(([label, amount, hint]) => <div key={String(label)} className="bg-white p-4">
          <dt className="text-sm text-text-muted">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{financeMoney(Number(amount))}</dd>
          <dd className="mt-1 text-xs text-text-muted">{hint}</dd>
        </div>)}
      </dl>
      {!range && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background p-4">
        <p className="max-w-2xl text-sm text-text-secondary">{!canAccrue && !canPay
          ? 'Доступен только просмотр расчёта и истории выплат.' : employee.available > 0
          ? `К начислению по расчёту: ${financeMoney(employee.available)}. Проверьте расшифровку и подтвердите сумму перед выплатой.`
          : employee.due > 0 ? 'Зарплата начислена. Выберите счёт и укажите сумму полной или частичной выплаты.'
            : employee.accrued > 0 ? 'Зарплата за этот месяц выплачена.' : 'Начислений пока нет. Расчёт появится после закрытия рабочих смен; сумму также можно начислить вручную.'}</p>
        {primaryAccrual ? <button type="button" className="btn-primary btn-md" onClick={() => setAction('calculated')}>Начислить {financeMoney(employee.available)}</button>
          : canPay && payable.length > 0 ? <button type="button" className="btn-primary btn-md" onClick={() => setAction('pay')}>Выплатить зарплату</button> : null}
        {primaryAccrual && canPay && payable.length > 0 && <button type="button" className="text-primary text-sm" onClick={() => setAction('pay')}>Выплатить уже начисленное</button>}
      </div>}
      <details className="rounded-lg border border-border" onToggle={(event) => setShowEvidence(event.currentTarget.open)}>
        <summary className="cursor-pointer px-4 py-3 font-medium">Расшифровка расчёта · {employee.hours == null ? '—' : number.format(employee.hours) + ' ч'} · {employee.shifts == null ? '—' : number.format(employee.shifts) + ' смен'}</summary>
        <PayrollTable headers={['Основание', 'За период', 'Сумма']} amounts={[1, 2]} rows={[
          { key: 'hours', cells: ['За часы', employee.hours == null ? '—' : number.format(employee.hours) + ' ч', financeMoney(employee.hourlyPay)] },
          { key: 'shifts', cells: ['За смены', employee.shifts == null ? '—' : number.format(employee.shifts) + ' смен', financeMoney(employee.shiftPay)] },
          { key: 'month', cells: ['Месячная ставка', employee.days == null ? '—' : number.format(employee.days) + ' раб. дней', financeMoney(employee.monthlyPay)] },
          { key: 'personal', cells: ['Личные продажи', financeMoney(employee.personalSales), financeMoney(employee.personalCommission)] },
          { key: 'shared', cells: ['Продажи за рабочую смену', financeMoney(employee.shiftSales), financeMoney(employee.shiftCommission)] },
        ]} />
        {showEvidence && <PayrollEvidence userId={employee.userId} period={range ?? month} />}
      </details>
      {!range && <section aria-label="Начисления за месяц">
        <h2 className="mb-2 font-semibold">Начисления за месяц</h2>
        <FinanceTable headers={['Дата', 'Начисление', 'Сумма', 'Выплачено', 'Остаток', '']} amounts={[2, 3, 4]}
          rows={entries.map((entry) => ({ key: entry.id, cells: [financeDateTime(entry.createdAt),
            <div>{entry.supplemental ? 'Премия / доплата' : entry.calculation ? 'По расчёту' : 'Вручную'}{entry.note && <p className="text-xs text-text-muted">{entry.note}</p>}</div>,
            entry.voidedAt ? <span className="line-through text-text-muted">{financeMoney(entry.amount)}</span> : financeMoney(entry.amount),
            financeMoney(entry.paidAmount), entry.voidedAt ? 'Отменено' : financeMoney(entry.amount - entry.paidAmount),
            <button type="button" className="text-primary" onClick={() => openEditor({ type: 'financeAccrualDetail', id: entry.id })}>{canAccrue ? 'История и исправления' : 'История'}</button>,
          ] }))} empty="Подтвердите расчёт, чтобы начислить зарплату за этот месяц." />
      </section>}
    </div>
    {canAccrue && action && action !== 'pay' && <AccrualForm key={action} employees={[{ id: employee.userId, name: employee.name }]}
      initialMonth={month} initialUser={employee.userId} calculated={action === 'calculated'} supplemental={action === 'bonus'}
      dialog fixedContext onClose={() => setAction('')} />}
    {canPay && action === 'pay' && payable[0] && <PayoutForm accounts={accounts} accrual={payable[0]} accruals={payable}
      dialog onClose={() => setAction('')} />}
  </EditorPage>;
}

function PayrollEvidence({ userId, period }: { userId: string; period: PayrollPeriod }) {
  const query = usePayroll(period, true, userId);
  const employee = query.data?.staff[0];
  if (query.isPending) return <div className="p-4"><Spinner /></div>;
  if (query.isError) return <p role="alert" className="p-4 text-sm text-danger">
    {apiError(query.error)} <button type="button" className="underline" onClick={() => void query.refetch()}>Повторить</button>
  </p>;
  if (!employee) return <p className="p-4 text-sm text-text-muted">Нет данных для расчёта.</p>;
  const sales = employee.rateIntervals.flatMap((interval) => interval.sales);
  return <div className="space-y-3 p-4">
    <h3 className="font-medium">Ставки по периодам</h3>
    <PayrollTable headers={['Период', 'Должность', 'За час', 'За смену', 'За месяц', 'Личный %', 'Сменный %']}
      amounts={[2, 3, 4, 5, 6]} rows={employee.rateIntervals.map((interval) => ({
        key: interval.from,
        cells: [shortDay(interval.from) + ' — ' + shortDay(interval.to), interval.position ?? '—',
          financeMoney(interval.effectiveDay ? interval.rates.hourly : null), financeMoney(interval.effectiveDay ? interval.rates.perShift : null),
          financeMoney(interval.effectiveDay ? interval.rates.monthly : null),
          interval.effectiveDay ? number.format(interval.rates.personalPercent) + '%' : '—',
          interval.effectiveDay ? number.format(interval.rates.shiftPercent) + '%' : '—'],
      }))} empty="Нет ставок за выбранный период" />
    <details>
      <summary className="cursor-pointer text-sm font-medium">Рабочие смены ({employee.workShifts.length})</summary>
      <PayrollTable headers={['Начало', 'Окончание']} rows={employee.workShifts.map((shift) => ({
        key: shift.id, cells: [financeDateTime(shift.startedAt), financeDateTime(shift.endedAt)],
      }))} empty="Закрытых смен за этот период нет" />
    </details>
    <details>
      <summary className="cursor-pointer text-sm font-medium">Продажи ({new Set(sales.map(({ orderId }) => orderId)).size})</summary>
      <PayrollTable headers={['Чек', 'Закрытие', 'Тип', 'Категория', 'База', 'Процент', 'Комиссия']} amounts={[4, 5, 6]}
        rows={sales.map((sale) => ({
          key: [sale.orderId, sale.kind, sale.categoryId ?? 'none'].join('.'),
          cells: [sale.number, financeDateTime(sale.closedAt),
            sale.kind === 'shiftPercent' ? 'За смену' : sale.openerRecorded ? 'Личная' : 'Личная · по данным старого чека',
            sale.categoryName ?? '—', financeMoney(sale.base), number.format(sale.percent) + '%',
            commissionNumber.format(sale.amount) + ' с'],
        }))} empty="Оплаченных чеков за этот период нет" />
    </details>
    <p className="text-xs text-text-muted">База продаж учитывает скидки и возвраты. Месячная ставка рассчитывается за отработанные дни.</p>
  </div>;
}

function PayrollTable(props: Parameters<typeof FinanceTable>[0]) {
  return <>
    <div className="hidden sm:block"><FinanceTable {...props} /></div>
    {props.rows.length > 0 ? <ul className="divide-y divide-border sm:hidden">
      {props.rows.map((row) => <li key={row.key} className="space-y-1.5 px-4 py-3 text-sm">
        <div className="break-words font-medium">{row.cells[0]}</div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {props.headers.slice(1).map((header, index) => <div key={header} className="min-w-0">
            <dt className="text-xs text-text-muted">{header}</dt>
            <dd className="break-words tabular-nums">{row.cells[index + 1]}</dd>
          </div>)}
        </dl>
      </li>)}
    </ul> : <p className="px-4 py-3 text-sm text-text-muted sm:hidden">{props.empty ?? 'Нет данных'}</p>}
  </>;
}
