import { Fragment, useState, type ReactNode } from 'react';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { usePageFilter, usePageFilters } from './workspace-route';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useIngredients } from './api';
import { balanceMoney, balanceQuantity as quantity } from './balance-format';

interface SummaryRow {
  id: string;
  ingredientId: string;
  name: string;
  kind: string;
  category: string | null;
  warehouseId: string;
  warehouseName: string;
  unit: string;
  openingQuantity: number;
  openingAvgCost: number | null;
  openingValue: number | null;
  incomingQuantity: number;
  outgoingQuantity: number;
  closingQuantity: number;
  closingAvgCost: number | null;
  closingValue: number | null;
  movementCount: number;
}
interface Summary {
  rows: SummaryRow[];
  totalRows: number;
  openingValue: number | null;
  closingValue: number | null;
  totalValuationAdjustment: number | null;
}
interface Props {
  filters?: ReactNode;
  periodFilter?: ReactNode;
  warehouseId?: string;
  range: { dateFrom: string; dateTo: string };
  onOpen: (type: string, id: string) => void;
  onHistory: (itemId: string, warehouseId?: string) => void;
}
const kinds = [
  { value: '', label: 'Все типы' },
  { value: 'raw', label: 'Ингредиент' },
  { value: 'goods', label: 'Товар' },
  { value: 'beverage', label: 'Напиток' },
  { value: 'preparation', label: 'Полуфабрикат' },
  { value: 'prepared_dish', label: 'Готовое блюдо' },
  { value: 'consumable', label: 'Расходник' },
];
function cost(value: number | null) {
  return value == null ? '—' : balanceMoney(value);
}

export function WarehouseMovementSummary({ warehouseId, range, onOpen, onHistory, filters, periodFilter }: Props) {
  const permissions = usePermissions();
  const canExport = permissions.canAction('exportReports');
  const [conditions, updateConditions] = usePageFilters({ movementSearch: '', movementKind: '', movementCategory: '', movementOnly: 'false', movementPage: '1', movementRange: '', movementExpanded: '', movementDocuments: '' });
  const { movementSearch: search, movementKind: kind, movementCategory: category, movementOnly: onlyWithMovement } = conditions;
  const rangeKey = `${warehouseId ?? ''}:${range.dateFrom}:${range.dateTo}`;
  const parsedPage = Number(conditions.movementPage);
  const page = conditions.movementRange === rangeKey && Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const expanded = conditions.movementExpanded;
  const setExpanded = (value: string | null) => updateConditions({ movementExpanded: value ?? '', movementDocuments: '' });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const ingredients = useIngredients('', warehouseId);
  const categories = [...new Set((ingredients.data ?? []).flatMap((item) => item.category ? [item.category] : []))];
  const params = { view: 'movement_summary', warehouseId, from: range.dateFrom, to: range.dateTo,
    search: search || undefined, kind: kind || undefined, category: category || undefined,
    onlyWithMovement, page, pageSize: 50 };
  const query = useQuery({ queryKey: ['admin', 'warehouse', 'reports', params],
    queryFn: async () => (await api.get<Summary>('/admin/warehouse/reports', { params })).data });
  function filter(patch: Partial<typeof conditions>) { updateConditions({ ...patch, movementPage: '1', movementRange: '', movementExpanded: '', movementDocuments: '' }); }
  function setPage(value: number) { updateConditions({ movementPage: String(value), movementRange: rangeKey, movementExpanded: '', movementDocuments: '' }); }
  async function download() {
    if (!canExport) return;
    setExporting(true); setError('');
    try {
      const response = await api.get('/admin/warehouse/reports/export.csv', { params, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Движение-продуктов-${range.dateFrom}-${range.dateTo}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(apiError(err)); }
    finally { setExporting(false); }
  }
  const rows = query.data?.rows ?? [];
  return (
    <section className="poster-report-surface" aria-label="Отчёт по движению продуктов">
      <div className="poster-toolbar print:hidden">
        <WorkspaceSearch label="Поиск продукта в движении" value={search} onChange={(value) => filter({ movementSearch: value })} />
        {periodFilter}
        {filters}
        <Select ariaLabel="Тип продукта" className="h-10 min-w-32" value={kind} options={kinds} onChange={(value) => filter({ movementKind: value })} />
        <Select ariaLabel="Категория продукта" className="h-10 min-w-40" value={category}
          options={[{ value: '', label: 'Все категории' }, ...categories.map((value) => ({ value, label: value }))]}
          onChange={(value) => filter({ movementCategory: value })} />
        <Select ariaLabel="Наличие движения" className="h-10 min-w-48" value={onlyWithMovement}
          options={[{ value: 'false', label: 'Все продукты' }, { value: 'true', label: 'Только с движением' }]}
          onChange={(value) => filter({ movementOnly: value })} />
        {canExport && <WorkspaceHeaderActions><button type="button" className="btn-ghost btn-md text-primary" disabled={exporting} onClick={() => void download()}>
          {exporting ? 'Экспорт…' : 'Экспорт'}
        </button></WorkspaceHeaderActions>}
      </div>
      {query.isPending && <div className="flex justify-center p-8"><Spinner /></div>}
      {(query.isError || error) && (
        <div role="alert" className="space-y-2 p-4 text-danger">
          <p>{error || apiError(query.error)}</p>
          {query.isError && <button type="button" className="text-primary" onClick={() => void query.refetch()}>Повторить загрузку</button>}
        </div>
      )}
      {query.data && <>
        <div className="hidden overflow-x-auto lg:block">
          <table className="poster-movement-table w-full min-w-[1120px] table-fixed text-left text-sm">
            <colgroup>
              <col style={{ width: '23%' }} />
              <col style={{ width: '11%' }} />
              {Array.from({ length: 8 }, (_, index) => <col key={index} style={{ width: '8.25%' }} />)}
            </colgroup>
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>{['Название', 'Тип', 'Нач. остаток', 'Себест. на начало', 'Нач. сумма', 'Поступления', 'Расход', 'Итог. остаток', 'Себест. на конец', 'Итог. сумма'].map((label, index) =>
                <th scope="col" key={label} title={label} className={`truncate px-3 py-3 font-medium ${index > 1 ? 'text-right' : ''}`}>{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => <Fragment key={row.id}>
                <tr data-expanded={expanded === row.id}>
                  <td className="px-3 py-3"><button type="button" title={row.name} className="flex w-full items-center gap-3 text-left text-text-primary"
                    aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                    <Chevron expanded={expanded === row.id} />
                    <span className="truncate">{row.name}</span>
                  </button>{!warehouseId && <span className="ml-6 block truncate text-xs text-text-muted" title={row.warehouseName}>{row.warehouseName}</span>}</td>
                  <td className="truncate px-3 py-3" title={kinds.find((item) => item.value === row.kind)?.label}>{kinds.find((item) => item.value === row.kind)?.label ?? row.kind}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{quantity(row.openingQuantity, row.unit)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{cost(row.openingAvgCost)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{cost(row.openingValue)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{quantity(row.incomingQuantity, row.unit)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{quantity(row.outgoingQuantity, row.unit)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{quantity(row.closingQuantity, row.unit)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{cost(row.closingAvgCost)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{cost(row.closingValue)}</td>
                </tr>
                {expanded === row.id && <tr className="poster-movement-detail"><td colSpan={10}>
                  <MovementDetails row={row} range={range} onOpen={onOpen} onHistory={onHistory} />
                </td></tr>}
              </Fragment>)}
            </tbody>
            <tfoot className="border-t border-border bg-background/50 font-medium"><tr>
              <td colSpan={4} className="px-3 py-3">Итого по выбранным условиям</td>
              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{cost(query.data.openingValue)}</td><td colSpan={4} />
              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{cost(query.data.closingValue)}</td>
            </tr></tfoot>
          </table>
        </div>
        <div className="divide-y divide-border lg:hidden">
          {rows.map((row) => <article key={row.id} className="space-y-3 p-4">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={expanded === row.id}
              onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
              <Chevron expanded={expanded === row.id} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-text-primary" title={row.name}>{row.name}</span><span className="text-xs text-text-muted">{row.warehouseName} · {kinds.find((item) => item.value === row.kind)?.label}</span></span>
            </button>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Figure label="Начальный остаток" value={quantity(row.openingQuantity, row.unit)} note={cost(row.openingValue)} />
              <Figure label="Конечный остаток" value={quantity(row.closingQuantity, row.unit)} note={cost(row.closingValue)} />
              <Figure label="Поступления" value={quantity(row.incomingQuantity, row.unit)} />
              <Figure label="Расход" value={quantity(row.outgoingQuantity, row.unit)} />
              <Figure label="Себестоимость на начало" value={cost(row.openingAvgCost)} />
              <Figure label="Себестоимость на конец" value={cost(row.closingAvgCost)} />
            </dl>
            {expanded === row.id && <MovementDetails row={row} range={range} onOpen={onOpen} onHistory={onHistory} />}
          </article>)}
          <div className="flex justify-between gap-3 p-4 text-sm font-medium"><span>Итоговая стоимость</span><span>{cost(query.data.closingValue)}</span></div>
        </div>
        {!rows.length && <p className="p-8 text-center text-sm text-text-muted">По выбранным условиям продуктов нет.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-xs text-text-muted">
          <span>«—» — себестоимость неизвестна или остаток равен нулю. Стоимость указана за единицу строки.</span>
          {query.data.totalValuationAdjustment != null && query.data.totalValuationAdjustment !== 0 && <span>Корректировка оценки: {cost(query.data.totalValuationAdjustment)}</span>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border p-3 print:hidden">
          <span className="mr-auto text-xs text-text-muted">{query.data.totalRows} строк</span>
          <button type="button" className="btn-secondary btn-md" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button>
          <span className="text-sm">{page} / {Math.max(1, Math.ceil(query.data.totalRows / 50))}</span>
          <button type="button" className="btn-secondary btn-md" disabled={page * 50 >= query.data.totalRows} onClick={() => setPage(page + 1)}>Далее</button>
        </div>
      </>}
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div><dt className="text-xs text-text-muted">{label}</dt><dd className="font-medium tabular-nums">{value}</dd>{note && <dd className="text-xs text-text-muted">{note}</dd>}</div>;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}>
      <path d="m6 4 4 4-4 4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MovementDetails({ row, range, onOpen, onHistory }: { row: SummaryRow; range: Props['range']; onOpen: Props['onOpen']; onHistory: Props['onHistory'] }) {
  const permissions = usePermissions();
  const [documentsFor, setDocumentsFor] = usePageFilter('movementDocuments');
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const documentsOpen = documentsFor === row.id;
  const params = { view: 'movements', ingredientId: row.ingredientId, warehouseId: row.warehouseId, from: range.dateFrom, to: range.dateTo, pageSize: 20 };
  const query = useQuery({ queryKey: ['admin', 'warehouse', 'reports', params], queryFn: async () => (await api.get<{
    movementGroups?: Array<{ direction: 'incoming' | 'outgoing'; sourceType: string; label: string; quantity: number; unit: string; averageCost: number | null; count: number }>;
    totalRows: number; rows: Array<{ id: string; createdAt: string; quantity: number; unit: string; totalCost: number | null; sourceType: string; sourceId: string | null; documentLabel: string; }>;
  }>('/admin/warehouse/reports', { params })).data });
  return (
    <div className="poster-movement-details space-y-3 text-sm">
      {query.isPending && <div className="flex justify-center py-6" aria-label="Загрузка движений"><Spinner /></div>}
      {query.isError && (
        <div role="alert" className="space-y-2 py-4">
          <p className="text-danger">{apiError(query.error)}</p>
          <button type="button" className="text-primary" onClick={() => void query.refetch()}>Повторить загрузку</button>
        </div>
      )}
      {query.data && (
        <>
        {query.data.movementGroups && (
          <div className="overflow-x-auto">
            <table className="poster-movement-detail-table poster-movement-groups w-full min-w-[480px] text-left" aria-label={`Сводка движения: ${row.name}`}>
              <thead><tr><th>Тип</th><th className="text-right">Количество</th><th className="text-right">Себестоимость</th></tr></thead>
              <tbody>
                {(['incoming', 'outgoing'] as const).map((direction) => {
                  const groups = query.data.movementGroups!.filter((group) => group.direction === direction);
                  const closed = closedGroups.includes(direction);
                  if (!groups.length) return null;
                  return <Fragment key={direction}>
                    <tr className="poster-movement-group-heading"><td colSpan={3}>
                      <button type="button" className="flex w-full items-center gap-3 text-left" aria-expanded={!closed}
                        onClick={() => setClosedGroups((current) => closed ? current.filter((value) => value !== direction) : [...current, direction])}>
                        <Chevron expanded={!closed} />{direction === 'incoming' ? 'Поставки' : 'Расход'}
                      </button>
                    </td></tr>
                    {!closed && groups.map((group) => <tr key={`${group.sourceType}:${group.unit}`}>
                      <td>{group.sourceType === 'purchase' ? 'Поставка' : group.label}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{quantity(group.quantity, group.unit)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{cost(group.averageCost)}</td>
                    </tr>)}
                  </Fragment>;
                })}
                {!query.data.movementGroups.length && <tr><td colSpan={3} className="text-center text-text-muted">За этот период поступлений и расхода нет.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-2 text-primary" aria-expanded={documentsOpen} onClick={() => setDocumentsFor(documentsOpen ? '' : row.id)}>
            <Chevron expanded={documentsOpen} />Документы · {query.data.totalRows}
          </button>
          <button type="button" className="text-primary" onClick={() => onHistory(row.ingredientId, row.warehouseId)}>Все движения и документы</button>
        </div>
        {(documentsOpen || !query.data.movementGroups) && (
        <div className="overflow-x-auto">
          <table className="poster-movement-detail-table w-full min-w-[640px] text-left" aria-label={`Документы движения: ${row.name}`}>
            <thead>
              <tr>
                <th scope="col">Дата</th>
                <th scope="col">Документ</th>
                <th scope="col" className="text-right">Количество</th>
                <th scope="col" className="text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((movement) => (
                <tr key={movement.id}>
                  <td className="whitespace-nowrap">
                    <time dateTime={movement.createdAt}>{new Date(movement.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                  </td>
                  <td>
                    {movement.sourceId && canOpenMovementSource(movement.sourceType, permissions) ? (
                      <button type="button" className="text-left text-primary" onClick={() => onOpen(movement.sourceType, movement.sourceId!)}>{movement.documentLabel}</button>
                    ) : movement.documentLabel}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{quantity(movement.quantity, movement.unit)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{cost(movement.totalCost)}</td>
                </tr>
              ))}
              {query.data.totalRows === 0 && <tr><td colSpan={4} className="py-6 text-center text-text-muted">За этот период движений нет.</td></tr>}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}
      {query.data && documentsOpen && query.data.totalRows > 20 && <p className="text-xs text-text-muted">Показаны последние 20 из {query.data.totalRows}. Полный список — по ссылке выше.</p>}
    </div>
  );
}

function canOpenMovementSource(type: string, permissions: ReturnType<typeof usePermissions>) {
  if (type === 'order') return permissions.canSection('orders');
  if (!permissions.canSection('warehouse')) return false;
  if (type === 'purchase') return permissions.canAction('warehouseReceive') && permissions.canAction('warehouseCosts');
  // Existing production, processing and stock documents only require warehouse access to read.
  return ['production', 'processing', 'inventory', 'writeoff', 'transfer', 'supplier_return', 'document'].includes(type);
}
