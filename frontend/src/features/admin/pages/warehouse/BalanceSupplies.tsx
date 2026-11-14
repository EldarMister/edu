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
      <div className="overflow-x-auto">
        <table className="poster-balance-supplies w-full min-w-[760px] table-fixed text-left">
          <colgroup><col style={{ width: 190 }} /><col /><col /><col /><col /><col /></colgroup>
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
                  {new Date(row.date).toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
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
      {pages > 1 && (
        <nav aria-label="Страницы поставок" className="mt-3 flex items-center justify-end gap-4 text-sm">
          <button type="button" className="text-primary disabled:text-text-muted" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button>
          <span>{page} / {pages}</span>
          <button type="button" className="text-primary disabled:text-text-muted" disabled={page >= pages} onClick={() => setPage(page + 1)}>Далее</button>
        </nav>
      )}
    </>
  );
}
