import { useId, useState, type FormEvent } from 'react';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { apiError } from '@/lib/api';
import { taxRateLabel } from '@/lib/format';
import { printReport } from '@/lib/report-output';
import type { MenuTax, MenuTaxType } from '@/types';
import { IconEdit, IconTrash } from '../admin/components/icons';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../admin/pages/WorkspaceHeader';
import { WorkspaceSearch } from '../admin/pages/WorkspaceSearch';
import { balanceMoney } from '../admin/pages/warehouse/balance-format';
import { useListPeriod } from '../admin/pages/warehouse/ListPeriodFilter';
import { visibleWarehouseColumns, WarehouseColumnSettings } from '../admin/pages/warehouse/WarehouseColumnSettings';
import { QueryState } from '../admin/pages/warehouse/WarehouseUi';
import { usePageFilters } from '../admin/pages/warehouse/workspace-route';
import { downloadTaxes, TAX_DIRECTORY_ENDPOINT, TAX_REPORT_ENDPOINT, TAX_REPORT_LABELS, TAX_TYPE_LABELS,
  useTaxDirectory, useTaxMutations, useTaxReport } from './taxes-api';

const labels = { name: 'Название', rate: 'Процент', type: 'Тип' } as const;
const defaultColumns = Object.keys(labels) as (keyof typeof labels)[];
const taxTypes = Object.entries(TAX_TYPE_LABELS).map(([value, label]) => ({ value, label }));
type PrintTable = { title: string; headers: string[]; rows: string[][] };

function parseRate(value: string) {
  const text = value.trim().replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(text) && Number(text) <= 100 ? Number(text) : undefined;
}

function TaxTableActions({ endpoint, params, table, canExport }: {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  table: PrintTable;
  canExport: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  async function exportTable() {
    if (exporting) return;
    setError('');
    setExporting(true);
    try { await downloadTaxes(endpoint, params, `${table.title}.xlsx`); }
    catch (failure) { setError(apiError(failure)); }
    finally { setExporting(false); }
  }
  return <>
    {canExport && <button type="button" className="supply-header-action" disabled={exporting || !table.rows.length}
      onClick={() => void exportTable()}>{exporting ? 'Выгрузка…' : 'Экспорт'}</button>}
    <button type="button" className="supply-header-action" disabled={!table.rows.length} onClick={() => {
      setError('');
      if (!printReport(table.title, '', table.headers, table.rows)) {
        setError('Разрешите всплывающие окна для печати.');
      }
    }}>Печать</button>
    {error && <span role="alert" className="text-xs text-danger">{error}</span>}
  </>;
}

export function TaxesPage() {
  const { canAction, canEditSection } = usePermissions();
  const editable = canEditSection('settings');
  const [filters, setFilters] = usePageFilters({ search: '', type: '', rate: '', sort: 'asc', taxColumns: '' });
  const queryParams = { search: filters.search.trim() || undefined, type: filters.type || undefined,
    rate: parseRate(filters.rate),
    sort: filters.sort === 'desc' ? 'desc' : 'asc' };
  const list = useTaxDirectory(queryParams);
  const taxes = list.data ?? [];
  const [savedColumns, saveColumns] = useColumnPreference('settings-taxes');
  const columns = visibleWarehouseColumns(filters.taxColumns || savedColumns, defaultColumns);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [editor, setEditor] = useState<MenuTax | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<MenuTax | null>(null);
  const { remove } = useTaxMutations();
  const text = (tax: MenuTax) => ({ name: tax.name, rate: taxRateLabel(tax.rate), type: TAX_TYPE_LABELS[tax.type] });
  const table = { title: 'Налоги', headers: columns.map((key) => labels[key]),
    rows: taxes.map((tax) => { const values = text(tax); return columns.map((key) => values[key]); }) };
  const filtered = Boolean(filters.search || filters.type || filters.rate);
  return <div className="space-y-3">
    <WorkspaceHeaderCount count={list.isSuccess ? taxes.length : undefined} />
    <div className="poster-toolbar">
      <WorkspaceSearch label="Поиск налогов" value={filters.search} onChange={(search) => setFilters({ search: search.slice(0, 80) })} />
      <Select ariaLabel="Тип налога" className="poster-filter w-auto gap-2" value={filters.type}
        options={[{ value: '', label: 'Тип' }, ...taxTypes]} onChange={(type) => setFilters({ type })} />
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        Ставка, %
        <input aria-label="Ставка налога" className="input h-9 w-20" type="text" inputMode="decimal" maxLength={6}
          value={filters.rate} aria-invalid={filters.rate !== '' && queryParams.rate === undefined}
          onChange={(event) => setFilters({ rate: event.target.value })} />
      </label>
      {filtered && <button type="button" className="text-sm text-primary"
        onClick={() => setFilters({ search: '', type: '', rate: '' })}>Сбросить</button>}
      <button type="button" className="supply-header-action ml-auto shrink-0 print:hidden"
        onClick={() => setColumnsOpen(true)}>Столбцы</button>
      <TaxTableActions endpoint={TAX_DIRECTORY_ENDPOINT} params={{ ...queryParams, columns: columns.join(',') }}
        table={table} canExport={canAction('exportReports')} />
      {editable && <button type="button" className="btn-primary btn-md" onClick={() => setEditor('new')}>Добавить налог</button>}
    </div>
    <QueryState pending={list.isPending} error={list.error}>
      <div className="overflow-x-auto">
        <table className="poster-table poster-directory-table w-full min-w-[340px]">
          <thead><tr>
            <th scope="col" aria-sort={queryParams.sort === 'desc' ? 'descending' : 'ascending'}>
              <button type="button" className="flex items-center gap-2"
                onClick={() => setFilters({ sort: queryParams.sort === 'desc' ? 'asc' : 'desc' })}>
                Название <span aria-hidden>{queryParams.sort === 'desc' ? '↓' : '↑'}</span>
              </button>
            </th>
            {columns.slice(1).map((key) => <th key={key} scope="col">{labels[key]}</th>)}
            {editable && <th scope="col"><span className="sr-only">Действия</span></th>}
          </tr></thead>
          <tbody>{taxes.map((tax) => {
            const values = text(tax);
            return <tr key={tax.id}>
              {columns.map((key) => <td key={key}>{values[key]}</td>)}
              {editable && <td className="w-24"><div className="flex justify-end gap-2">
                <button type="button" className="rounded-lg p-2 text-text-muted hover:bg-background hover:text-primary"
                  aria-label={`Редактировать налог «${tax.name}»`} onClick={() => setEditor(tax)}><IconEdit className="h-4 w-4" /></button>
                <button type="button" className="rounded-lg p-2 text-text-muted hover:bg-background hover:text-danger"
                  aria-label={`Удалить налог «${tax.name}»`} onClick={() => { remove.reset(); setToDelete(tax); }}><IconTrash className="h-4 w-4" /></button>
              </div></td>}
            </tr>;
          })}</tbody>
        </table>
        {!taxes.length && <p role="status" className="py-10 text-center text-sm text-text-muted">
          {filtered ? 'Нет налогов по выбранным условиям' : 'Налоговых ставок пока нет'}
        </p>}
      </div>
    </QueryState>
    {columnsOpen && <WarehouseColumnSettings columns={columns} defaults={defaultColumns} label={(key) => labels[key]}
      onClose={() => setColumnsOpen(false)} onApply={(selection) => {
        const value = selection.join(',') === defaultColumns.join(',') ? '' : selection.join(',');
        saveColumns(value);
        setFilters({ taxColumns: value });
        setColumnsOpen(false);
      }} />}
    {editor && <TaxEditor tax={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />}
    {toDelete && <Modal open title="Удаление налога" onClose={() => !remove.isPending && setToDelete(null)}
      footer={<div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-md" disabled={remove.isPending} onClick={() => setToDelete(null)}>Отмена</button>
        <button type="button" className="btn-danger btn-md" disabled={remove.isPending}
          onClick={() => remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })}>Удалить</button>
      </div>}>
      <p>Удалить налог «{toDelete.name}»?</p>
      {remove.error && <p role="alert" className="mt-2 text-sm text-danger">{apiError(remove.error)}</p>}
    </Modal>}
  </div>;
}

function TaxEditor({ tax, onClose }: { tax?: MenuTax; onClose: () => void }) {
  const id = useId();
  const { save } = useTaxMutations();
  const [name, setName] = useState(tax?.name ?? '');
  const [rate, setRate] = useState(tax ? String(tax.rate) : '');
  const initialType = tax?.type ?? 'turnover';
  const [type, setType] = useState<MenuTaxType>(initialType);
  const percent = parseRate(rate);
  const close = () => { if (!save.isPending) onClose(); };
  const dirty = name !== (tax?.name ?? '') || rate !== (tax ? String(tax.rate) : '') || type !== initialType;
  const { markSaved } = useEditorDirty(dirty, saveTax);

  async function saveTax() {
    if (!name.trim() || percent === undefined || save.isPending) return false;
    try {
      await save.mutateAsync({ id: tax?.id, name: name.trim(), rate: percent, type });
      markSaved();
      onClose();
      return true;
    } catch {
      return false;
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void saveTax();
  }
  return <Modal open title={tax ? 'Редактирование налога' : 'Добавление налога'} onClose={close}
    footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={close} disabled={save.isPending}>Отмена</button>
      <button type="submit" form={id} className="btn-primary btn-md" disabled={!name.trim() || percent === undefined || save.isPending}>Сохранить</button>
    </div>}>
    <form id={id} onSubmit={submit}>
      <fieldset disabled={save.isPending} className="grid gap-4 text-sm">
        <label className="grid gap-1">Название<input className="input" autoFocus required maxLength={80} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <label className="grid gap-1">Процент<input className="input" inputMode="decimal" required maxLength={6} value={rate}
          onChange={(event) => setRate(event.target.value)} /></label>
        {rate && percent === undefined && <p role="alert" className="text-danger">Укажите процент от 0 до 100 с точностью до двух знаков.</p>}
        <div className="grid gap-1"><span>Тип</span>
          <Select ariaLabel="Тип налога" value={type} options={taxTypes} disabled={save.isPending} onChange={(value) => setType(value as MenuTaxType)} />
        </div>
        <p className="text-text-muted">
          {type === 'vat' ? 'НДС выделяется из цены продажи с учётом скидки.' : 'Налог считается от суммы продажи с учётом скидки.'}
        </p>
      </fieldset>
      {save.error && <p role="alert" className="mt-2 text-sm text-danger">{apiError(save.error)}</p>}
    </form>
  </Modal>;
}

const reportHeaders = ['Название', 'Процент', 'Тип', 'Операция', 'Сумма продаж', 'Сумма налога'];
const sortable = ['name', 'rate', null, null, 'salesAmount', 'amount'] as const;

export function TaxReportPage() {
  const { canAction } = usePermissions();
  const period = useListPeriod('tax', 'currentMonth');
  const [filters, update] = usePageFilters({ kind: '', sort: 'name', direction: 'asc' });
  const params = { from: period.range.dateFrom, to: period.range.dateTo,
    kind: filters.kind || undefined, sort: filters.sort, direction: filters.direction };
  const query = useTaxReport(params);
  const rows = query.data ?? [];
  const table = { title: 'Налоги с продаж', headers: reportHeaders, rows: rows.map((row) =>
    [row.name, taxRateLabel(row.rate), TAX_TYPE_LABELS[row.type], TAX_REPORT_LABELS[row.operation ?? row.kind],
      balanceMoney(Number(row.salesAmount)), balanceMoney(Number(row.amount))]) };
  return <div className="space-y-3">
    <WorkspaceHeaderActions>
      <TaxTableActions endpoint={TAX_REPORT_ENDPOINT} params={params} table={table} canExport={canAction('exportReports')} />
      {period.filter}
    </WorkspaceHeaderActions>
    <div className="poster-toolbar">
      <Select ariaLabel="Операции с налогом" className="w-auto" value={filters.kind} onChange={(kind) => update({ kind })}
        options={[{ value: '', label: 'Все операции' }, ...Object.entries(TAX_REPORT_LABELS).map(([value, label]) => ({ value, label }))]} />
    </div>
    <QueryState pending={query.isPending} error={query.error}>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr>{reportHeaders.map((label, index) => {
            const key = sortable[index];
            const active = key === filters.sort;
            return <th key={label} scope="col" className={`border-b border-border p-3 font-medium ${index >= 4 ? 'text-right' : 'text-left'}`}
              aria-sort={active ? filters.direction === 'desc' ? 'descending' : 'ascending' : undefined}>
              {key ? <button type="button" onClick={() => update({ sort: key, direction: active && filters.direction === 'asc' ? 'desc' : 'asc' })}>
                {label}{active && <span aria-hidden> {filters.direction === 'desc' ? '↓' : '↑'}</span>}
              </button> : label}
            </th>;
          })}</tr></thead>
          <tbody>{table.rows.map((cells, index) => <tr key={JSON.stringify(rows[index])} className="border-b border-border last:border-0">
            {cells.map((value, column) => <td key={column} className={`p-3 ${column >= 4 ? 'text-right tabular-nums' : ''}`}>{value}</td>)}
          </tr>)}</tbody>
        </table>
        {!rows.length && <p role="status" className="py-10 text-center text-sm text-text-muted">За этот период нет операций с налогом</p>}
      </div>
    </QueryState>
  </div>;
}
