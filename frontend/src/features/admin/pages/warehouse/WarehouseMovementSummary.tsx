import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { qty, useIngredients } from './api';

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
const cost = (value: number | null) => value == null ? '—' : money(value);

export function WarehouseMovementSummary(props: Props) {
  // A location/period change starts at page one and closes the previous details.
  return <MovementSummaryBody key={`${props.warehouseId ?? ''}:${props.range.dateFrom}:${props.range.dateTo}`} {...props} />;
}

function MovementSummaryBody({ warehouseId, range, onOpen, onHistory }: Props) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [onlyWithMovement, setOnlyWithMovement] = useState('false');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const ingredients = useIngredients('', warehouseId);
  const categories = [...new Set((ingredients.data ?? []).flatMap((item) => item.category ? [item.category] : []))];
  const params = { view: 'movement_summary', warehouseId, from: range.dateFrom, to: range.dateTo,
    search: search || undefined, kind: kind || undefined, category: category || undefined,
    onlyWithMovement, page, pageSize: 50 };
  const query = useQuery({ queryKey: ['admin', 'warehouse', 'reports', params],
    queryFn: async () => (await api.get<Summary>('/admin/warehouse/reports', { params })).data });
  function filter(update: () => void) { update(); setPage(1); setExpanded(null); }
  async function download() {
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
    <section className="card overflow-hidden" aria-label="Отчёт по движению продуктов">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4 print:hidden">
        <input className="input h-10 w-full sm:w-60" aria-label="Поиск продукта в движении" placeholder="Поиск продукта"
          value={search} onChange={(event) => filter(() => setSearch(event.target.value))} />
        <Select ariaLabel="Тип продукта" className="h-10 min-w-40" value={kind} options={kinds} onChange={(value) => filter(() => setKind(value))} />
        <Select ariaLabel="Категория продукта" className="h-10 min-w-40" value={category}
          options={[{ value: '', label: 'Все категории' }, ...categories.map((value) => ({ value, label: value }))]}
          onChange={(value) => filter(() => setCategory(value))} />
        <Select ariaLabel="Наличие движения" className="h-10 min-w-48" value={onlyWithMovement}
          options={[{ value: 'false', label: 'Все продукты' }, { value: 'true', label: 'Только с движением' }]}
          onChange={(value) => filter(() => setOnlyWithMovement(value))} />
        <button type="button" className="btn-secondary btn-md sm:ml-auto" disabled={exporting} onClick={() => void download()}>
          {exporting ? 'Экспорт…' : 'Экспорт'}
        </button>
      </div>
      {query.isPending && <div className="flex justify-center p-8"><Spinner /></div>}
      {(query.isError || error) && <p role="alert" className="p-4 text-danger">{error || apiError(query.error)}</p>}
      {query.data && <>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>{['Название / склад', 'Тип', 'Нач. остаток', 'Себест. на начало', 'Нач. сумма', 'Поступления', 'Расход', 'Итог. остаток', 'Себест. на конец', 'Итог. сумма'].map((label) =>
                <th scope="col" key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => <Fragment key={row.id}>
                <tr>
                  <td className="px-3 py-3"><button type="button" className="flex items-center gap-2 text-left font-medium text-primary"
                    aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                    <span aria-hidden="true">{expanded === row.id ? '▾' : '▸'}</span>{row.name}
                  </button><span className="ml-6 block text-xs text-text-muted">{row.warehouseName}</span></td>
                  <td className="px-3 py-3">{kinds.find((item) => item.value === row.kind)?.label ?? row.kind}</td>
                  <td className="px-3 py-3 tabular-nums">{qty(row.openingQuantity, row.unit)}</td>
                  <td className="px-3 py-3 tabular-nums">{cost(row.openingAvgCost)}</td>
                  <td className="px-3 py-3 tabular-nums">{cost(row.openingValue)}</td>
                  <td className="px-3 py-3 tabular-nums">{qty(row.incomingQuantity, row.unit)}</td>
                  <td className="px-3 py-3 tabular-nums">{qty(row.outgoingQuantity, row.unit)}</td>
                  <td className="px-3 py-3 font-medium tabular-nums">{qty(row.closingQuantity, row.unit)}</td>
                  <td className="px-3 py-3 tabular-nums">{cost(row.closingAvgCost)}</td>
                  <td className="px-3 py-3 font-medium tabular-nums">{cost(row.closingValue)}</td>
                </tr>
                {expanded === row.id && <tr><td colSpan={10} className="bg-background/40 p-4">
                  <MovementDetails row={row} range={range} onOpen={onOpen} onHistory={onHistory} />
                </td></tr>}
              </Fragment>)}
            </tbody>
            <tfoot className="border-t border-border bg-background/50 font-medium"><tr>
              <td colSpan={4} className="px-3 py-3">Итого по выбранным условиям</td>
              <td className="px-3 py-3">{cost(query.data.openingValue)}</td><td colSpan={4} />
              <td className="px-3 py-3">{cost(query.data.closingValue)}</td>
            </tr></tfoot>
          </table>
        </div>
        <div className="divide-y divide-border lg:hidden">
          {rows.map((row) => <article key={row.id} className="space-y-3 p-4">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={expanded === row.id}
              onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
              <span><span className="block font-medium text-primary">{row.name}</span><span className="text-xs text-text-muted">{row.warehouseName} · {kinds.find((item) => item.value === row.kind)?.label}</span></span>
              <span aria-hidden="true">{expanded === row.id ? '▾' : '▸'}</span>
            </button>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Figure label="Начальный остаток" value={qty(row.openingQuantity, row.unit)} note={cost(row.openingValue)} />
              <Figure label="Конечный остаток" value={qty(row.closingQuantity, row.unit)} note={cost(row.closingValue)} />
              <Figure label="Поступления" value={qty(row.incomingQuantity, row.unit)} />
              <Figure label="Расход" value={qty(row.outgoingQuantity, row.unit)} />
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
          {query.data.totalValuationAdjustment != null && query.data.totalValuationAdjustment !== 0 && <span>Корректировка оценки: {money(query.data.totalValuationAdjustment)}</span>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border p-3 print:hidden">
          <span className="mr-auto text-xs text-text-muted">{query.data.totalRows} строк</span>
          <button type="button" className="btn-secondary btn-md" disabled={page === 1} onClick={() => { setPage((value) => value - 1); setExpanded(null); }}>Назад</button>
          <span className="text-sm">{page} / {Math.max(1, Math.ceil(query.data.totalRows / 50))}</span>
          <button type="button" className="btn-secondary btn-md" disabled={page * 50 >= query.data.totalRows} onClick={() => { setPage((value) => value + 1); setExpanded(null); }}>Далее</button>
        </div>
      </>}
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div><dt className="text-xs text-text-muted">{label}</dt><dd className="font-medium tabular-nums">{value}</dd>{note && <dd className="text-xs text-text-muted">{note}</dd>}</div>;
}

function MovementDetails({ row, range, onOpen, onHistory }: { row: SummaryRow; range: Props['range']; onOpen: Props['onOpen']; onHistory: Props['onHistory'] }) {
  const params = { view: 'movements', ingredientId: row.ingredientId, warehouseId: row.warehouseId, from: range.dateFrom, to: range.dateTo, pageSize: 20 };
  const query = useQuery({ queryKey: ['admin', 'warehouse', 'reports', params], queryFn: async () => (await api.get<{
    totalRows: number; rows: Array<{ id: string; createdAt: string; quantity: number; unit: string; totalCost: number; sourceType: string; sourceId: string | null; documentLabel: string; }>;
  }>('/admin/warehouse/reports', { params })).data });
  return <div className="space-y-3 text-sm">
    <div className="flex flex-wrap justify-between gap-2"><strong>Движения: {row.name}</strong><button type="button" className="text-primary" onClick={() => onHistory(row.ingredientId, row.warehouseId)}>Все движения и документы</button></div>
    {query.isPending && <Spinner />}
    {query.isError && <p role="alert" className="text-danger">{apiError(query.error)}</p>}
    {query.data?.rows.map((movement) => <div key={movement.id} className="flex flex-wrap justify-between gap-2 border-t border-border pt-2">
      <div>{movement.sourceId ? <button type="button" className="text-left text-primary" onClick={() => onOpen(movement.sourceType, movement.sourceId!)}>{movement.documentLabel}</button> : movement.documentLabel}
        <span className="block text-xs text-text-muted">{new Date(movement.createdAt).toLocaleString('ru-RU')}</span></div>
      <span className="tabular-nums">{qty(movement.quantity, movement.unit)} · {money(movement.totalCost)}</span>
    </div>)}
    {query.data?.totalRows === 0 && <p className="text-text-muted">За этот период движений нет.</p>}
    {query.data && query.data.totalRows > 20 && <p className="text-xs text-text-muted">Показаны последние 20 из {query.data.totalRows}. Полный список — по ссылке выше.</p>}
  </div>;
}
