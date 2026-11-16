import { useState, type ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { IconPrinter, IconTables } from '../../components/icons';
import { WarehouseColumnSettings } from '../warehouse/WarehouseColumnSettings';
import './finance-register.css';

export interface RegisterColumn {
  key: string;
  label: string;
  width?: string;
  numeric?: boolean;
  sort?: { ascending?: boolean; toggle: () => void };
}

interface Cell {
  value: string | number | null;
  display?: ReactNode;
}

interface RegisterRow {
  id: string;
  values: Record<string, Cell>;
  action?: ReactNode;
}

type Output = (string | number | null)[][];

export function downloadRegister(title: string, output: Output) {
  const csv = output.map((row) => row.map((value) => {
    if (typeof value === 'number') return value.toFixed(2).replace('.', ',');
    const text = value ?? '';
    const safe = /^[=+\-@]/.test(text.trimStart()) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = title + '.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printRegister(title: string, output: Output) {
  const popup = window.open('', '_blank', 'width=1000,height=730');
  if (!popup) return false;
  popup.opener = null;
  const doc = popup.document;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = 'body{font:13px system-ui;margin:24px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #aaa}th{font-weight:600}';
  doc.head.append(style);
  const heading = doc.createElement('h1');
  heading.textContent = title;
  const table = doc.createElement('table');
  output.forEach((values, index) => {
    const row = (index ? table : table.createTHead()).insertRow();
    values.forEach((value) => {
      const cell = doc.createElement(index ? 'td' : 'th');
      cell.textContent = typeof value === 'number' ? value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value ?? '';
      row.append(cell);
    });
  });
  doc.body.append(heading, table);
  popup.addEventListener('afterprint', () => popup.close(), { once: true });
  popup.focus();
  popup.print();
  return true;
}

export function FinanceRegister({
  title, columns, rows, filters, tools, empty, totals, defaultColumns, reportActions = true,
}: {
  title: string;
  columns: RegisterColumn[];
  rows: RegisterRow[];
  filters: ReactNode;
  tools?: ReactNode;
  empty: string;
  totals?: Record<string, Cell>;
  defaultColumns?: string[];
  reportActions?: boolean;
}) {
  const [selection, setSelection] = useState<string[]>();
  const [showColumns, setShowColumns] = useState(false);
  const [printError, setPrintError] = useState(false);
  const { canAction } = usePermissions();
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const keys = columns.map(({ key }) => key);
  const visible = (selection ?? defaultColumns ?? keys).flatMap((key) => {
    const column = byKey.get(key);
    return column ? [column] : [];
  });
  const showActions = rows.some(({ action }) => !!action);
  const output = () => [
    visible.map(({ label }) => label),
    ...rows.map(({ values }) => visible.map(({ key }) => values[key]?.value ?? null)),
    ...(totals ? [visible.map(({ key }) => totals[key]?.value ?? null)] : []),
  ];

  return <section className="finance-register" aria-label={title}>
    <div className="finance-register-toolbar print:hidden">
      <div className="finance-register-filters">{filters}</div>
      <div className="finance-register-tools">
        {defaultColumns && <button type="button" className="finance-tool" onClick={() => setShowColumns(true)}>
          <IconTables aria-hidden="true" /> Столбцы
        </button>}
        {reportActions && rows.length > 0 && <>
          {canAction('exportReports') && <button type="button" className="finance-tool" onClick={() => downloadRegister(title, output())}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 3v12m-4-8 4-4 4 4M6 13H4v7h16v-7h-2" />
            </svg> Экспорт
          </button>}
          <button type="button" className="finance-tool" onClick={() => setPrintError(!printRegister(title, output()))}>
            <IconPrinter aria-hidden="true" /> Печать
          </button>
        </>}
        {tools}
      </div>
    </div>
    {printError && <p className="px-4 py-2 text-sm text-danger" role="alert">Разрешите всплывающие окна для печати отчёта.</p>}
    <div className="finance-register-scroll" tabIndex={0} role="region" aria-label="Таблица">
      <table className="finance-register-table">
        <colgroup>
          {visible.map(({ key, width }) => <col key={key} style={{ width }} />)}
          {showActions && <col style={{ width: '84px' }} />}
        </colgroup>
        <thead><tr>
          {visible.map(({ key, label, numeric, sort }) => <th scope="col" key={key} className={numeric ? 'finance-register-number text-right' : undefined}
            aria-sort={sort?.ascending == null ? undefined : sort.ascending ? 'ascending' : 'descending'}>
            {sort ? <button type="button" className="finance-register-sort" onClick={sort.toggle}>
              {label}<span aria-hidden="true">{sort.ascending == null ? '↕' : sort.ascending ? '▴' : '▾'}</span>
            </button> : label}
          </th>)}
          {showActions && <th scope="col"><span className="sr-only">Действия</span></th>}
        </tr></thead>
        <tbody>
          {rows.map(({ id, values, action }) => <tr key={id}>
            {visible.map(({ key, numeric }) => <td key={key} className={numeric ? 'finance-register-number' : undefined}>
              {values[key]?.display ?? values[key]?.value ?? '—'}
            </td>)}
            {showActions && <td className="finance-register-action">{action}</td>}
          </tr>)}
          {!rows.length && <tr><td className="finance-register-empty" colSpan={visible.length}>{empty}</td></tr>}
        </tbody>
        {totals && rows.length > 0 && <tfoot><tr>
          {visible.map(({ key, numeric }) => <td key={key} className={numeric ? 'finance-register-number' : undefined}>
            {totals[key]?.display ?? totals[key]?.value}
          </td>)}
          {showActions && <td />}
        </tr></tfoot>}
      </table>
    </div>
    {showColumns && defaultColumns && <WarehouseColumnSettings columns={visible.map(({ key }) => key)} defaults={keys} resetColumns={defaultColumns}
      label={(key) => byKey.get(key)?.label ?? key}
      onClose={() => setShowColumns(false)}
      onApply={(selected) => { setSelection(selected); setShowColumns(false); }} />}
  </section>;
}
