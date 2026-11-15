import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { Spinner } from '@/components/Spinner';
import type { UnitType } from './units';
import { balanceMoney, balanceQuantity } from './balance-format';

interface SupplyRow {
  purchaseId: string;
  number: number;
  date: string;
  warehouseId: string | null;
  warehouseName: string;
  supplier: string;
  quantity: number;
  unitCode: string;
  unit: string;
  unitPrice: number | null;
  total: number;
}

interface SuppliesPage {
  rows: SupplyRow[];
  total: number;
  page: number;
  pageSize: number;
}

const supplyDate = (date: string) => new Date(date).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function BalanceSupplies({
  ingredientId,
  warehouseId,
  unitType,
}: {
  ingredientId: string;
  warehouseId?: string;
  unitType: UnitType;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['admin', 'warehouse', 'ingredient-supplies', ingredientId, warehouseId, page],
    queryFn: async () =>
      (await api.get<SuppliesPage>(`/admin/warehouse/ingredients/${encodeURIComponent(ingredientId)}/supplies`, {
        params: { warehouseId, page, pageSize: 20 },
      })).data,
  });

  if (query.isPending) {
    return <div role="status" aria-label="Загрузка поставок" className="flex justify-center py-6"><Spinner /></div>;
  }
  if (query.isError) {
    return (
      <div role="alert" className="py-4">
        <p className="text-danger">{apiError(query.error)}</p>
        <button type="button" className="mt-2 text-primary" onClick={() => void query.refetch()}>
          Повторить загрузку
        </button>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(query.data.total / query.data.pageSize));
  return (
    <>
      <div className="poster-balance-supply-desktop overflow-x-auto">
        <table className="poster-balance-supplies w-full min-w-[760px] table-fixed text-left">
          <colgroup>{Array.from({ length: 6 }, (_, index) => <col key={index} style={{ width: `${100 / 6}%` }} />)}</colgroup>
          <thead>
            <tr>
              <th>Дата поставки</th>
              <th>Склад</th>
              <th>Поставщик</th>
              <th className="text-right">Количество</th>
              <th className="text-right">Цена за единицу</th>
              <th className="text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {query.data.rows.map((row) => (
              <tr key={row.purchaseId}>
                <td className="whitespace-nowrap">
                  <time dateTime={row.date}>{supplyDate(row.date)}</time>
                </td>
                <td>{row.warehouseName}</td>
                <td>{row.supplier || '—'}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{balanceQuantity(row.quantity, row.unit, unitType)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{row.unitPrice == null ? '—' : balanceMoney(row.unitPrice)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{balanceMoney(row.total)}</td>
              </tr>
            ))}
            {!query.data.rows.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-text-muted">Поставок пока нет</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="poster-balance-supply-mobile">
        {query.data.rows.map((row) => <article key={row.purchaseId}>
          <time dateTime={row.date}>{supplyDate(row.date)}</time>
          <dl>
            <dt>Склад</dt><dd>{row.warehouseName}</dd>
            <dt>Поставщик</dt><dd>{row.supplier || '—'}</dd>
            <dt>Количество</dt><dd>{balanceQuantity(row.quantity, row.unit, unitType)}</dd>
            <dt>Цена за единицу</dt><dd>{row.unitPrice == null ? '—' : balanceMoney(row.unitPrice)}</dd>
            <dt>Сумма</dt><dd>{balanceMoney(row.total)}</dd>
          </dl>
        </article>)}
        {!query.data.rows.length && <p className="p-5 text-center text-sm text-text-muted">Поставок пока нет</p>}
      </div>
      {pages > 1 && (
        <nav aria-label="Страницы поставок" className="poster-balance-pagination">
          <span>{(page - 1) * query.data.pageSize + 1}–{Math.min(page * query.data.pageSize, query.data.total)} из {query.data.total}</span>
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button>
          <span aria-current="page">{page} / {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Далее</button>
        </nav>
      )}
    </>
  );
}
