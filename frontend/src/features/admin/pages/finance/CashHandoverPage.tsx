import { useId, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { QueryState } from '../warehouse/WarehouseUi';
import { usePageFilters } from '../warehouse/workspace-route';
import { FinancePeriod } from './FinancePeriod';
import { FinanceRegister } from './FinanceRegister';
import { useCashHandover, useCashHandoverWrites, type CashHandoverRow } from './api';
import { financeDateTime, financeDay, financeMoney, parseMoney } from './finance-format';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: 'Asia/Bishkek' });
const dateCell = (date: string) => dateFormat.format(new Date(date + 'T00:00:00Z'));
const moneyCell = (value: number | null) => ({ value, display: financeMoney(value) });
const sumMoney = (amounts: number[]) => amounts.reduce((cents, amount) => cents + Math.round(amount * 100), 0) / 100;

export function CashHandoverPage() {
  const today = financeDay();
  const [{ handoverFrom: from, handoverTo: to, handoverEmployee: employee }, setFilters] = usePageFilters({
    handoverFrom: today.slice(0, 7) + '-01', handoverTo: today, handoverEmployee: '',
  });
  const [byReceiptDate, setByReceiptDate] = useState(false);
  const [selected, setSelected] = useState<CashHandoverRow | null>(null);
  const report = useCashHandover(from, to);
  const { setEnabled } = useCashHandoverWrites();
  const period = <FinancePeriod from={from} to={to} onApply={(value) => setFilters({ handoverFrom: value.from, handoverTo: value.to })} />;
  if (!report.data || report.isError) return <>
    <div className="poster-toolbar">{period}</div>
    <QueryState pending={report.isPending} error={report.error} />
    {report.isError && <button type="button" className="btn-secondary btn-md" onClick={() => void report.refetch()}>Повторить</button>}
  </>;

  const data = report.data;
  const employees = [...new Map(data.rows.map(({ employeeId, employee: name }) => [employeeId, name])).entries()]
    .sort(([, a], [, b]) => a.localeCompare(b, 'ru'));
  const rows = data.rows.filter(({ employeeId }) => !employee || employee === employeeId);
  const filters = <>{period}{!byReceiptDate && <Select ariaLabel="Сотрудник" value={employee} onChange={(value) => setFilters({ handoverEmployee: value })}
    options={[{ value: '', label: 'Все сотрудники' }, ...employees.map(([value, label]) => ({ value, label })),
      ...(employee && !employees.some(([id]) => id === employee) ? [{ value: employee, label: 'Выбранный сотрудник' }] : [])]} />}</>;

  return <div className="grid gap-4">
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-semibold">Принимать наличные от официантов вручную</p>
        <p className="mt-1 text-sm text-text-muted">При включённом режиме наличные по новым чекам официантов поступают в кассу после подтверждения сдачи.</p>
      </div>
      {data.canConfigure ? <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" role="switch" aria-label="Принимать наличные от официантов вручную" checked={data.enabled}
          disabled={setEnabled.isPending} onChange={(event) => setEnabled.mutate(event.target.checked)} />
        {data.enabled ? 'Включено' : 'Выключено'}
      </label> : <span className="text-sm text-text-muted">{data.enabled ? 'Включено владельцем' : 'Выключено'}</span>}
      {setEnabled.isError && <p role="alert" className="w-full text-sm text-danger">{apiError(setEnabled.error)}</p>}
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Вид отчёта">
      <button type="button" aria-pressed={!byReceiptDate} onClick={() => setByReceiptDate(false)}
        className={byReceiptDate ? 'btn-secondary btn-md' : 'btn-primary btn-md'}>По сотрудникам</button>
      <button type="button" aria-pressed={byReceiptDate} onClick={() => setByReceiptDate(true)}
        className={byReceiptDate ? 'btn-primary btn-md' : 'btn-secondary btn-md'}>По дням приёма</button>
    </div>
    {byReceiptDate ? <FinanceRegister key="cash-handover-daily" title="Поступления наличных по дням" filters={filters}
      empty="За этот период сдачу наличных не проводили"
      columns={[{ key: 'date', label: 'Дата поступления' }, { key: 'amount', label: 'Поступило с учётом уточнений', numeric: true }]}
      rows={data.daily.map(({ date, amount }) => ({ id: date, values: {
        date: { value: dateCell(date) }, amount: moneyCell(amount),
      } }))}
      totals={{ date: { value: 'Итого' }, amount: moneyCell(sumMoney(data.daily.map(({ amount }) => amount))) }} />
      : <FinanceRegister key="cash-handover-staff" title="Сдача наличных" filters={filters} empty="За этот период нет наличных к сдаче"
        columns={[
          { key: 'date', label: 'Дата продажи', width: 135 },
          { key: 'employee', label: 'Сотрудник', width: 175 },
          { key: 'due', label: 'К сдаче', numeric: true, width: 110 },
          { key: 'received', label: 'Сдал', numeric: true, width: 110 },
          { key: 'difference', label: 'Разница', numeric: true, width: 110 },
          { key: 'receivedAt', label: 'Принято / уточнено', width: 175 },
        ]}
        rows={rows.map((row) => ({ id: row.id, values: {
          date: { value: dateCell(row.date) }, employee: { value: row.employee },
          due: moneyCell(row.due), received: moneyCell(row.received),
          difference: { value: row.difference, display: <span className={row.difference < 0 ? 'text-danger' : undefined}>
            {row.difference > 0 ? '+' : ''}{financeMoney(row.difference)}</span> },
          receivedAt: { value: row.receivedAt ? financeDateTime(row.receivedAt) : row.due ? 'Ожидает сдачи' : 'Нет суммы к сдаче' },
        }, action: data.canReceive && <button type="button" className="text-primary hover:underline"
          onClick={() => setSelected(row)}>{row.received === null ? 'Принять' : 'Уточнить'}</button> }))}
        totals={{ date: { value: 'Итого' }, ...Object.fromEntries((['due', 'received', 'difference'] as const)
          .map((key) => [key, moneyCell(sumMoney(rows.map((row) => row[key] ?? 0)))])) }} />}
    {selected && <ReceiveCashDialog row={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function ReceiveCashDialog({ row, onClose }: { row: CashHandoverRow; onClose: () => void }) {
  const formId = useId();
  const [value, setValue] = useState(row.received?.toString() ?? '');
  const { receive } = useCashHandoverWrites();
  const amount = parseMoney(value);
  const disabled = amount === null || amount < 0 || amount > 99_999_999.99 || receive.isPending;
  const close = () => { if (!receive.isPending) onClose(); };
  return <Modal open title={row.received === null ? 'Принять наличные' : 'Уточнить сдачу наличных'} onClose={close}
    footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={close} disabled={receive.isPending}>Отмена</button>
      <button type="submit" form={formId} className="btn-primary btn-md" disabled={disabled}>Подтвердить сдачу</button>
    </div>}>
    <form id={formId} className="grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (!disabled && amount !== null) receive.mutate({ employeeId: row.employeeId, date: row.date, amount,
        expectedReceivedAt: row.receivedAt ?? undefined }, { onSuccess: onClose });
    }}>
      <p className="font-semibold">{row.employee} · {dateCell(row.date)}</p>
      <p className="text-sm text-text-secondary">К сдаче {financeMoney(row.due)}</p>
      <label className="grid gap-1.5 text-sm">Фактически сдал за день
        <input className="input w-full" inputMode="decimal" value={value} autoFocus placeholder="0,00"
          disabled={receive.isPending} onChange={(event) => { setValue(event.target.value); receive.reset(); }} />
      </label>
      {row.received !== null && <p className="text-sm text-text-muted">Ранее принято {financeMoney(row.received)}. В кассе отразится разница.</p>}
      {receive.isError && <p role="alert" className="text-sm text-danger">{apiError(receive.error)}</p>}
    </form>
  </Modal>;
}
