import { useState } from 'react';
import { Select } from '@/components/Select';
import { EditorPage } from '../warehouse/EditorPage';
import type { EditorRoute } from '../warehouse/workspace-route';
import type { FinanceAccount, PayrollReport, PayrollStaffRow } from './api';
import { FinanceTable } from './CashShiftsPage';
import { AccrualForm, PayoutForm } from './FinanceForms';
import { financeDateTime, financeMoney } from './finance-format';

export function payrollMonthLabel(month: string) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T00:00:00Z'));
}
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function PayrollEmployeeCard({ employee, month, entries, accounts, canAccrue, canPay, onClose, openEditor }: {
  employee: PayrollStaffRow; month: string; entries: PayrollReport['records']; accounts: FinanceAccount[];
  canAccrue: boolean; canPay: boolean; onClose: () => void; openEditor: (editor: EditorRoute) => void;
}) {
  const [action, setAction] = useState('');
  const payable = entries.filter((entry) => !entry.voidedAt && entry.amount > entry.paidAmount);
  const primaryAccrual = canAccrue && employee.available > 0;
  return <EditorPage title={employee.name} onClose={onClose}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-secondary">{payrollMonthLabel(month)} · {employee.position || 'Без должности'}</p>
        {canAccrue && <Select ariaLabel="Дополнительные действия с зарплатой" value="" placeholder="Другие действия"
          onChange={setAction} options={[{ value: 'bonus', label: 'Добавить премию или доплату' }, { value: 'manual', label: 'Начислить вручную' }]} />}
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {[
          ['Рассчитано', employee.estimate, 'По ставкам должности'], ['Начислено', employee.accrued, 'Подтверждено, включая доплаты'],
          ['Выплачено', employee.paid, 'Списано со счетов'], ['Остаток', employee.due, 'Ещё нужно выплатить'],
        ].map(([label, amount, hint]) => <div key={String(label)} className="bg-white p-4">
          <dt className="text-sm text-text-muted">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{financeMoney(Number(amount))}</dd>
          <dd className="mt-1 text-xs text-text-muted">{hint}</dd>
        </div>)}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background p-4">
        <p className="max-w-2xl text-sm text-text-secondary">{!canAccrue && !canPay
          ? 'Доступен только просмотр расчёта и истории выплат.' : employee.available > 0
          ? `К начислению по расчёту: ${financeMoney(employee.available)}. Проверьте расшифровку и подтвердите сумму перед выплатой.`
          : employee.due > 0 ? 'Зарплата начислена. Выберите счёт и укажите сумму полной или частичной выплаты.'
            : employee.accrued > 0 ? 'Зарплата за этот месяц выплачена.' : 'Начислений пока нет. Расчёт появится после закрытия рабочих смен; сумму также можно начислить вручную.'}</p>
        {primaryAccrual ? <button type="button" className="btn-primary btn-md" onClick={() => setAction('calculated')}>Начислить {financeMoney(employee.available)}</button>
          : canPay && payable.length > 0 ? <button type="button" className="btn-primary btn-md" onClick={() => setAction('pay')}>Выплатить зарплату</button> : null}
        {primaryAccrual && canPay && payable.length > 0 && <button type="button" className="text-primary text-sm" onClick={() => setAction('pay')}>Выплатить уже начисленное</button>}
      </div>
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 font-medium">Расшифровка расчёта · {number.format(employee.hours ?? 0)} ч · {number.format(employee.shifts ?? 0)} смен</summary>
        <FinanceTable headers={['Основание', 'Ставка', 'За месяц', 'Сумма']} amounts={[1, 2, 3]} rows={[
          { key: 'hours', cells: ['За часы', financeMoney(employee.rates.hourly), number.format(employee.hours ?? 0) + ' ч', financeMoney(employee.hourlyPay)] },
          { key: 'shifts', cells: ['За смены', financeMoney(employee.rates.perShift), number.format(employee.shifts ?? 0) + ' смен', financeMoney(employee.shiftPay)] },
          { key: 'month', cells: ['Месячная ставка', financeMoney(employee.rates.monthly), number.format(employee.days ?? 0) + ' раб. дней', financeMoney(employee.monthlyPay)] },
          { key: 'personal', cells: ['Личные продажи', number.format(employee.rates.personalPercent) + '%', financeMoney(employee.personalSales), financeMoney(employee.personalCommission)] },
          { key: 'shared', cells: ['Продажи за рабочую смену', number.format(employee.rates.shiftPercent) + '%', financeMoney(employee.shiftSales), financeMoney(employee.shiftCommission)] },
        ]} />
        <p className="px-4 py-3 text-xs text-text-muted">Месячная ставка делится на календарные дни месяца и умножается на отработанные дни. Учитываются закрытые рабочие смены.</p>
      </details>
      <section aria-label="Начисления за месяц">
        <h2 className="mb-2 font-semibold">Начисления за месяц</h2>
        <FinanceTable headers={['Дата', 'Начисление', 'Сумма', 'Выплачено', 'Остаток', '']} amounts={[2, 3, 4]}
          rows={entries.map((entry) => ({ key: entry.id, cells: [financeDateTime(entry.createdAt),
            <div>{entry.supplemental ? 'Премия / доплата' : entry.calculation ? 'По расчёту' : 'Вручную'}{entry.note && <p className="text-xs text-text-muted">{entry.note}</p>}</div>,
            entry.voidedAt ? <span className="line-through text-text-muted">{financeMoney(entry.amount)}</span> : financeMoney(entry.amount),
            financeMoney(entry.paidAmount), entry.voidedAt ? 'Отменено' : financeMoney(entry.amount - entry.paidAmount),
            <button type="button" className="text-primary" onClick={() => openEditor({ type: 'financeAccrualDetail', id: entry.id })}>{canAccrue ? 'История и исправления' : 'История'}</button>,
          ] }))} empty="Подтвердите расчёт, чтобы начислить зарплату за этот месяц." />
      </section>
    </div>
    {canAccrue && action && action !== 'pay' && <AccrualForm key={action} employees={[{ id: employee.userId, name: employee.name }]}
      initialMonth={month} initialUser={employee.userId} calculated={action === 'calculated'} supplemental={action === 'bonus'}
      dialog fixedContext onClose={() => setAction('')} />}
    {canPay && action === 'pay' && payable[0] && <PayoutForm accounts={accounts} accrual={payable[0]} accruals={payable}
      dialog onClose={() => setAction('')} />}
  </EditorPage>;
}
