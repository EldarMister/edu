import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { usePermissions } from '@/hooks/usePermissions';
import { printReport } from '@/lib/report-output';
import { IconPrinter, IconTables } from '../../components/icons';
import type { CashFlow, FinanceAccount, FinanceCategory, FinanceEntry } from './api';
import { buildCashFlowTable, flowCell, type FlowColumn, type FlowLine, type FlowMovement } from './cash-flow-table';
import { downloadRegister } from './FinanceRegister';
import './cash-flow-table.css';

const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: 'Asia/Bishkek' });
const types = [{ label: 'карта', type: 'noncash' }, { label: 'наличн.', type: 'cash' }] as const;
const summaryMeasures = [
  { id: 'opening', label: 'На начало периода' },
  { id: 'income', label: 'Поступления' },
  { id: 'expense', label: 'Расходы' },
  { id: 'closing', label: 'На конец периода' },
] as const;

type Detail = { key: string; label: string; trigger: HTMLButtonElement; movements: FlowMovement[] };

export function CashFlowMatrix({ flow, accounts, categories, entries, from, to, selectedAccounts, setAccounts, period }: {
  flow: CashFlow; accounts: FinanceAccount[]; categories: FinanceCategory[]; entries: FinanceEntry[];
  from: string; to: string; selectedAccounts: string; setAccounts: (value: string) => void; period: ReactNode;
}) {
  const { canAction } = usePermissions();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [printError, setPrintError] = useState(false);
  const [savedColumns, saveColumns] = useColumnPreference('finance-cash-flow');
  const extraColumns = savedColumns.split(',').filter(Boolean);
  const showAmounts = extraColumns.includes('amounts');
  const showPercent = extraColumns.includes('percent');

  function toggleColumn(key: string, checked: boolean) {
    saveColumns((checked ? [...extraColumns, key] : extraColumns.filter((column) => column !== key)).join(','));
  }
  const scope = useMemo(() => new Set(selectedAccounts.split(',').filter(Boolean)), [selectedAccounts]);
  const includedAccounts = useMemo(() => !scope.size ? accounts : accounts.filter(({ id }) => scope.has(id)), [accounts, scope]);
  const { periods, lines, byAccount } = useMemo(
    () => buildCashFlowTable(flow, includedAccounts, categories, entries, from, to),
    [flow, includedAccounts, categories, entries, from, to],
  );
  const scopeLabel = scope.size ? includedAccounts.map(({ name }) => name).join(', ') : 'Все счета';
  const columns = periods.flatMap((bucket): FlowColumn[] => [
    { id: bucket.key, label: showAmounts || showPercent ? bucket.shortLabel + ', всего' : bucket.label, period: bucket },
    ...(showAmounts ? types.map(({ label, type }) =>
      ({ id: bucket.key + ':' + type, label: bucket.shortLabel + ', ' + label, period: bucket, type })) : []),
    ...(showPercent ? types.map(({ label, type }) =>
      ({ id: bucket.key + ':' + type + ':%', label: bucket.shortLabel + ', ' + label + ' %', period: bucket, type, percent: true })) : []),
  ]);
  const totalColumn = columns.find(({ id }) => id === 'total');
  const netLine = lines.find(({ measure }) => measure === 'net');

  function toggle(id: string) {
    setExpanded((list) => list.includes(id) ? list.filter((key) => key !== id) : [...list, id]);
  }

  function toPercent(line: FlowLine, column: FlowColumn, cents: number) {
    const total = flowCell(line, { ...column, type: undefined }, byAccount).cents;
    if (!total) return '—';
    return percent.format(cents ? cents / total : 0);
  }

  function outputReport(format: 'csv' | 'print') {
    function exportLines(visible: FlowLine[], depth: number): (string | number)[][] {
      return visible.flatMap((line) => [
        ['  '.repeat(depth) + line.label, ...columns.map((column) => {
          const { cents } = flowCell(line, column, byAccount);
          return column.percent ? toPercent(line, column, cents) : cents / 100;
        })],
        ...exportLines(line.children ?? [], depth + 1),
      ]);
    }
    const headings = ['Статья', ...columns.map(({ label }) => label)];
    const rows = exportLines(lines, 0);
    if (format === 'csv') {
      downloadRegister('Движение денег ' + from + ' — ' + to, [
        ['Движение денег', scopeLabel, from, to], headings, ...rows,
      ]);
      return;
    }
    setPrintError(!printReport('Движение денег', scopeLabel + ' · ' + from + ' — ' + to, headings,
      rows.map((row) => row.map((value) => typeof value === 'number' ? money.format(value) : value))));
  }

  function renderRows(visible: FlowLine[], prefix = '', depth = 0): ReactNode[] {
    return visible.flatMap((line) => {
      const id = prefix + '/' + line.id;
      const isExpanded = expanded.includes(id);
      return [
        <tr key={id} className={depth === 0 ? 'cash-flow-total' : undefined}>
          <th scope="row" className="cash-flow-label" style={{ paddingLeft: 12 + depth * 17 }}>
            {line.children?.length ? <button type="button" aria-expanded={isExpanded} onClick={() => toggle(id)}>
              <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>{line.label}
            </button> : <span>{line.label}</span>}
          </th>
          {columns.map((column) => {
            const { cents, movements } = flowCell(line, column, byAccount);
            const value = column.percent ? toPercent(line, column, cents) : money.format(cents / 100);
            const cell = id + ':' + column.id;
            return <td key={column.id} className={column === totalColumn ? 'cash-flow-period-total' : undefined}>
              {movements.length && !column.percent ? <button type="button" className="cash-flow-amount"
                aria-label={line.label + ', ' + column.label + ', ' + value}
                aria-haspopup="dialog" aria-expanded={detail?.key === cell}
                onClick={(event) => setDetail({ key: cell, label: line.label + ' · ' + column.label, trigger: event.currentTarget, movements })}>
                {value} <span aria-hidden="true">▾</span>
              </button> : <span className="cash-flow-static">{value}</span>}
            </td>;
          })}
        </tr>,
        ...(isExpanded ? renderRows(line.children ?? [], id, depth + 1) : []),
      ];
    });
  }

  return <section className="cash-flow-report min-w-0 space-y-3">
    {totalColumn && <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-4"
      aria-label="Итоги за период">
      {summaryMeasures.map(({ id, label }) => {
        const line = lines.find((row) => row.id === id);
        const cents = line ? flowCell(line, totalColumn, byAccount).cents : 0;
        return <div key={id}
          className="min-w-0 border-border px-4 py-3 even:border-l max-md:[&:nth-child(n+3)]:border-t md:border-l md:first:border-l-0">
          <dt className="text-sm text-text-muted">{label}</dt>
          <dd className="mt-1 break-words text-lg font-semibold tabular-nums text-text-primary sm:text-xl">{money.format(cents / 100)} с</dd>
        </div>;
      })}
    </dl>}
    <div className="cash-flow-card min-w-0 rounded-xl border border-border bg-card">
      <div className="cash-flow-toolbar">
        <div className="cash-flow-filters">
          <CashFlowAccountFilter accounts={accounts} selected={scope} onChange={(value) => {
            setDetail(null);
            setAccounts(value);
          }} />
          {period}
        </div>
        <div className="cash-flow-tools">
          {flow.accountOpening && <details className="cash-flow-column-menu">
            <summary className="btn-secondary btn-md"><IconTables className="h-4 w-4" /> Столбцы <span aria-hidden="true">▾</span></summary>
            <div>
              <label><input type="checkbox" checked={showAmounts} onChange={(event) => toggleColumn('amounts', event.target.checked)} /> Карта и наличные, деньги</label>
              <label><input type="checkbox" checked={showPercent} onChange={(event) => toggleColumn('percent', event.target.checked)} /> Карта и наличные, %</label>
            </div>
          </details>}
          {canAction('exportReports') && <button type="button" className="btn-secondary btn-md" onClick={() => outputReport('csv')}>Экспорт CSV</button>}
          <button type="button" className="btn-secondary btn-md" onClick={() => outputReport('print')}>
            <IconPrinter className="h-4 w-4" /> Печать
          </button>
        </div>
      </div>
      {printError && <p role="alert" className="border-b border-border px-4 py-2 text-sm text-danger">
        Разрешите всплывающие окна, чтобы распечатать отчёт
      </p>}
      <div className="cash-flow-scroll" tabIndex={0} role="region" aria-label="Движение денег по месяцам">
        <table className="cash-flow-grid">
          <thead><tr>
            <th scope="col" className="cash-flow-label">Статья</th>
            {columns.map((column) => <th key={column.id} scope="col" className={column === totalColumn ? 'cash-flow-period-total' : undefined}>
              {column.label}
            </th>)}
          </tr></thead>
          <tbody>{renderRows(lines.filter((line) => line !== netLine))}</tbody>
          {netLine && <tfoot>{renderRows([netLine])}</tfoot>}
        </table>
      </div>
    </div>
    {detail && <CashFlowDetail detail={detail} accounts={byAccount} close={() => setDetail(null)} />}
  </section>;
}

function CashFlowAccountFilter({ accounts, selected, onChange }: {
  accounts: FinanceAccount[]; selected: Set<string>; onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(selected);
  const menu = useRef<HTMLDetailsElement>(null);
  const chosen = accounts.filter(({ id }) => selected.has(id));
  const caption = chosen.length === 1 ? chosen[0].name : chosen.length > 1 ? 'Счета · ' + chosen.length : 'Счёт';
  const filtered = accounts.filter(({ name }) => name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));
  return <details ref={menu} className="cash-flow-column-menu cash-flow-account-filter" onToggle={(event) => {
    if (event.currentTarget.open) {
      setSearch('');
      setDraft(new Set(selected));
    }
  }}>
    <summary className="btn-secondary btn-md" aria-label="Счёт"><span className="truncate">{caption}</span> <span aria-hidden="true">▾</span></summary>
    <div>
      <div className="cash-flow-filter-actions">
        <button type="button" className="text-primary" onClick={() => setDraft(new Set(accounts.map(({ id }) => id)))}>Выбрать все</button>
        <button type="button" className="text-primary" onClick={() => setDraft(new Set())}>Очистить</button>
      </div>
      <input className="input w-full" aria-label="Поиск счёта" placeholder="Поиск…" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="cash-flow-account-options">
        {filtered.map(({ id, name }) => <label key={id}><input type="checkbox" checked={draft.has(id)} onChange={() => setDraft((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })} /> {name}</label>)}
        {!filtered.length && <p className="p-2 text-sm text-text-muted">Счета не найдены</p>}
      </div>
      <button type="button" className="btn-primary btn-md w-full" onClick={() => {
        onChange(draft.size === accounts.length ? '' : [...draft].sort().join(','));
        menu.current?.removeAttribute('open');
      }}>Применить</button>
    </div>
  </details>;
}

function CashFlowDetail({ detail, accounts, close }: { detail: Detail; accounts: Map<string, FinanceAccount>; close: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const popup = panel.current;
    if (!popup) return;
    const { bottom, top, right } = detail.trigger.getBoundingClientRect();
    const below = window.innerHeight - bottom - 8;
    const above = top - 8;
    const placeAbove = below < popup.offsetHeight + 4 && above > below;
    const space = (placeAbove ? above : below) - 4;
    popup.style.maxHeight = Math.max(96, space) + 'px';
    popup.style.left = Math.max(8, Math.min(right - popup.offsetWidth, window.innerWidth - popup.offsetWidth - 8)) + 'px';
    popup.style.top = Math.max(8, placeAbove ? top - popup.offsetHeight - 4 : bottom + 4) + 'px';
    popup.querySelector('button')?.focus({ preventScroll: true });
  }, [detail]);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !detail.trigger.contains(event.target)) close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      detail.trigger.focus({ preventScroll: true });
    }
    function onScroll(event: Event) {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [close, detail]);

  return createPortal(<div ref={panel} className="cash-flow-detail" role="dialog" aria-label={detail.label}>
    <button type="button" aria-label="Закрыть операции" className="cash-flow-close" onClick={() => {
      close();
      detail.trigger.focus({ preventScroll: true });
    }}>×</button>
    <table>
      <thead><tr>{['Дата', 'Категория', 'Комментарий', 'Сумма', 'Счёт'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{[...detail.movements].sort((a, b) => b.at.localeCompare(a.at)).map((movement) => <tr key={movement.id}>
        <td>{date.format(new Date(movement.at))}</td><td>{movement.category}</td><td>{movement.note}</td>
        <td>{money.format(movement.cents / 100)}</td><td>{accounts.get(movement.accountId)?.name ?? '—'}</td>
      </tr>)}</tbody>
    </table>
  </div>, document.body);
}
