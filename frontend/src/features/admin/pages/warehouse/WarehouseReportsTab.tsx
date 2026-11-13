import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import {costLabel} from './cost-format';
import { money } from '@/lib/format';
import { useStaff } from '../../api';
import { qty, useIngredients } from './api';

interface ReportRow {
  id: string;
  createdAt: string | null;
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  warehouseName: string;
  quantity: number;
  unit: string;
  unitCost: number|null;
  costKnown?:boolean;
  totalCost: number|null;
  valuationAdjustment?: number;
  sourceType: string | null;
  sourceId: string | null;
  documentLabel: string | null;
  employeeName: string | null;
  reason: string | null;
}
interface SalesPerformance {
  ordersCount: number;
  netRevenue: number;
  actualCost: number;
  grossMargin: number | null;
  marginPercent: number | null;
  foodCostPercent: number | null;
  missingCostLines: number;
  unknownPriceLines: number;
  complete: boolean;
  note: string;
}
interface Report {
  salesPerformance?: SalesPerformance;
  totalValuationAdjustment?: number;
  rows: ReportRow[];
  totalRows: number;
  totalCost: number|null;
  page: number;
  pageSize: number;
}
export function WarehouseReportsTab({
  warehouseId,
  range,
  view,
  onView,
  ingredientId,
  onOpen,
}: {
  warehouseId?: string;
  range: { dateFrom: string; dateTo: string };
  view: string;
  onView: (v: string) => void;
  ingredientId?: string;
  onOpen: (type: string, id: string) => void;
}) {
  const [item, setItem] = useState(ingredientId ?? '');
  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState('');
  const staff = useStaff('', '');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const ingredients = useIngredients('', warehouseId);
  const params = {
    view,
    warehouseId,
    from: range.dateFrom,
    to: range.dateTo,
    ingredientId: item || undefined,
    search: search || undefined,
    employeeId: employee || undefined,
    category: category || undefined,
    type: type || undefined,
    page,
    pageSize: 100,
  };
  const query = useQuery({
    queryKey: ['admin', 'warehouse', 'reports', params],
    queryFn: async () => (await api.get<Report>('/admin/warehouse/reports', { params })).data,
  });
  async function download() {
    setExporting(true);
    setError('');
    try {
      const response = await api.get('/admin/warehouse/reports/export.csv', { params, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Склад-${view}-${range.dateFrom}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setExporting(false);
    }
  }
  const categories = [...new Set((ingredients.data ?? []).flatMap((i) => (i.category ? [i.category] : [])))];
  return (
    <div className="card overflow-hidden">
      <div className="space-y-3 border-b border-border p-4 print:hidden">
        <div className="flex flex-wrap gap-2">
          <Select
            ariaLabel="Вид отчёта"
            className="h-10 min-w-48"
            value={view}
            onChange={(v) => {
              onView(v);
              setPage(1);
            }}
            options={[
              { value: 'balances', label: 'Остатки' },
              { value: 'movements', label: 'Движение товаров' },
              { value: 'purchases', label: 'Закупки' },
              { value: 'losses', label: 'Списания и потери' },
              { value: 'sales', label: 'Себестоимость продаж' },
              { value: 'variances', label: 'Расхождения' },
            ]}
          />
          <input
            className="input h-10 flex-1 sm:max-w-xs"
            aria-label="Поиск в отчёте"
            placeholder="Поиск по товару"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <button
            type="button"
            className="btn-secondary btn-md"
            onClick={() => void download()}
            disabled={exporting}
          >
            CSV / Excel
          </button>
          <button type="button" className="btn-secondary btn-md" onClick={() => window.print()}>
            Печать
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            ariaLabel="Товар отчёта"
            className="h-9 min-w-44"
            value={item}
            onChange={(v) => {
              setItem(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Все товары' },
              ...(ingredients.data ?? []).map((i) => ({ value: i.id, label: i.name })),
            ]}
          />
          <Select
            ariaLabel="Категория отчёта"
            className="h-9 min-w-40"
            value={category}
            onChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Все категории' },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
          />
          {view !== 'balances' && (
            <Select
              ariaLabel="Сотрудник отчёта"
              className="h-9 min-w-40"
              value={employee}
              onChange={(v) => {
                setEmployee(v);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Все сотрудники' },
                ...(staff.data ?? []).map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          )}
          {view !== 'balances' && (
            <Select
              ariaLabel="Тип движения"
              className="h-9 min-w-40"
              value={type}
              onChange={(v) => {
                setType(v);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Все типы движения' },
                { value: 'purchase', label: 'Приход' },
                { value: 'sale', label: 'Продажа' },
                { value: 'return', label: 'Возврат' },
                { value: 'writeoff', label: 'Списание' },
                { value: 'inventory', label: 'Инвентаризация' },
                { value: 'correction', label: 'Корректировка' },
                { value: 'transfer', label: 'Перемещение' },
                { value: 'supplier_return', label: 'Возврат поставщику' },
                { value: 'production', label: 'Производство' },
                { value: 'processing', label: 'Переработка' },
                { value: 'cancel', label: 'Отмена' },
              ]}
            />
          )}
        </div>
        {view === 'sales' && (
          <p className="text-xs text-text-muted">
            Фактический расход по историческим движениям. Это себестоимость продуктов, без зарплаты, аренды и
            прочих расходов.
          </p>
        )}
      </div>
      {query.isPending && (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}
      {(query.isError || error) && (
        <p role="alert" className="p-4 text-danger">
          {error || apiError(query.error)}
        </p>
      )}
      {query.data?.salesPerformance && (
        <div className="space-y-2 border-b border-border p-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              Выручка после скидок
              <p className="font-semibold">{money(query.data.salesPerformance.netRevenue)}</p>
            </div>
            <div>
              Фактическая себестоимость
              <p className="font-semibold">{money(query.data.salesPerformance.actualCost)}</p>
            </div>
            <div>
              Маржа до прочих расходов
              <p className="font-semibold">
                {query.data.salesPerformance.grossMargin == null
                  ? 'Недостаточно данных'
                  : money(query.data.salesPerformance.grossMargin)}
              </p>
            </div>
            <div>
              Маржа, %
              <p className="font-semibold">
                {query.data.salesPerformance.marginPercent == null
                  ? '—'
                  : `${query.data.salesPerformance.marginPercent.toFixed(1)}%`}
              </p>
            </div>
          </div>
          <p
            className={`text-xs ${query.data.salesPerformance.complete ? 'text-text-muted' : 'text-warning'}`}
          >
            {query.data.salesPerformance.note}
          </p>
        </div>
      )}
      {query.data && (
        <>
          <div className="flex flex-wrap justify-between gap-3 p-4 text-sm">
            <span>{query.data.totalRows} строк</span>
            <span className="font-semibold">
              Итого: {costLabel(query.data.totalCost)}
              {query.data.totalValuationAdjustment
                ? ` · корректировка оценки ${money(query.data.totalValuationAdjustment)}`
                : ''}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-y border-border bg-background/50 text-xs text-text-muted">
                <tr>
                  <th className="px-3 py-3">Товар / дата</th>
                  <th className="px-3 py-3">Склад</th>
                  <th className="px-3 py-3">Количество</th>
                  <th className="px-3 py-3">Стоимость единицы</th>
                  <th className="px-3 py-3">Сумма</th>
                  {view === 'movements' && <th className="px-3 py-3">Корректировка оценки</th>}
                  <th className="px-3 py-3">Документ / сотрудник</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {query.data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-3">
                      <span className="font-medium">{row.ingredientName}</span>
                      <span className="block text-xs text-text-muted">
                        {row.createdAt ? new Date(row.createdAt).toLocaleString('ru-RU') : row.category}
                      </span>
                    </td>
                    <td className="px-3 py-3">{row.warehouseName}</td>
                    <td className="px-3 py-3">{qty(row.quantity, row.unit)}</td>
                    <td className="px-3 py-3">
                      {costLabel(row.unitCost)} / {row.unit}
                    </td>
                    <td className="px-3 py-3">{costLabel(row.totalCost)}</td>
                    {view === 'movements' && (
                      <td className="px-3 py-3">
                        {row.valuationAdjustment ? money(row.valuationAdjustment) : '—'}
                      </td>
                    )}
                    <td className="px-3 py-3">
                      {row.sourceId ? (
                        <button
                          type="button"
                          className="text-left text-primary"
                          onClick={() => onOpen(row.sourceType ?? '', row.sourceId!)}
                        >
                          {row.documentLabel ?? 'Открыть источник'}
                        </button>
                      ) : (
                        (row.documentLabel ?? 'Текущий остаток')
                      )}
                      {row.employeeName && (
                        <span className="block text-xs text-text-muted">{row.employeeName}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!query.data.rows.length && (
            <p className="p-8 text-center text-sm text-text-muted">По выбранным условиям движений нет.</p>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-border p-3 print:hidden">
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Назад
            </button>
            <span className="text-sm">
              {page} / {Math.max(1, Math.ceil(query.data.totalRows / 100))}
            </span>
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={page * 100 >= query.data.totalRows}
              onClick={() => setPage((p) => p + 1)}
            >
              Далее
            </button>
          </div>
        </>
      )}
    </div>
  );
}
