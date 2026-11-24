import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { api } from '@/lib/api';
import { financeDateTime, financeMoney } from '../pages/finance/finance-format';
import { recipeQuantity } from '../pages/warehouse/recipe-draft-values';
import { QueryState } from '../pages/warehouse/WarehouseUi';

type OrderStockMovement = {
  id: string;
  type: 'sale' | 'return' | 'writeoff' | 'prepared-loss';
  occurredAt: string;
  name: string;
  warehouseName: string;
  unit: string;
  quantity: number;
  lineCost: number | null;
};

type OrderStockDetail = {
  rows: OrderStockMovement[];
  canViewCosts: boolean;
  totalCost: number | null;
};

const movementLabels = { sale: 'Списание', return: 'Возврат на склад', writeoff: 'Списание при отмене', 'prepared-loss': 'Потери при приготовлении' };

export function OrderStockMovements({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const costsAllowed = usePermissions().canAction('warehouseCosts');
  const query = useQuery({
    queryKey: ['admin', 'orders', 'stock-movements', orderId, costsAllowed],
    enabled: open,
    queryFn: async ({ signal }) => (await api.get<OrderStockDetail>(`/admin/orders/${encodeURIComponent(orderId)}/stock-movements`, { signal })).data,
  });
  const data = query.data;
  const showCosts = costsAllowed && data?.canViewCosts === true;
  return <details className="rounded-xl border border-border" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Списания со склада</summary>
    {open && <div className="border-t border-border px-3 pb-3 sm:px-4">
      <QueryState pending={query.isPending} error={query.error}>
        {data?.rows.length ? <>
          <ul className="divide-y divide-border">
            {data.rows.map((movement) => <MovementRow key={movement.id} movement={movement} showCosts={showCosts} />)}
          </ul>
          {showCosts && <div className="flex flex-wrap items-baseline justify-between gap-1 border-t border-border pt-3 text-sm font-medium">
            <span>Итого по движениям</span>
            <span className="tabular-nums">{data.totalCost == null ? 'Себестоимость известна не для всех движений' : financeMoney(data.totalCost)}</span>
          </div>}
        </> : <p className="pt-3 text-sm text-text-muted">По этому чеку нет складских движений.</p>}
      </QueryState>
      {query.isError && <button type="button" className="btn-secondary btn-md mt-2" onClick={() => void query.refetch()}>Повторить загрузку</button>}
    </div>}
  </details>;
}

function MovementRow({ movement, showCosts }: { movement: OrderStockMovement; showCosts: boolean }) {
  const loss = movement.type === 'prepared-loss';
  const sign = movement.quantity < 0 ? '−' : movement.quantity > 0 && !loss ? '+' : '';
  return <li className="space-y-1.5 py-3 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <strong className="min-w-0 break-words font-medium">{movement.name}</strong>
      <span className="text-xs text-text-muted"><time dateTime={movement.occurredAt}>{financeDateTime(movement.occurredAt)}</time></span>
    </div>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="min-w-0 break-words text-text-secondary">{movementLabels[movement.type]} · {movement.warehouseName}</span>
      <span className="whitespace-nowrap tabular-nums">{sign}{recipeQuantity(Math.abs(movement.quantity), movement.unit)}</span>
    </div>
    {loss ? <p className="text-xs text-text-muted">Количество уже учтено в списании.</p> : showCosts && <dl className="flex justify-between gap-2 text-xs text-text-secondary">
      <dt>Себестоимость</dt><dd className="font-medium tabular-nums">{movement.lineCost == null ? '—' : financeMoney(movement.lineCost)}</dd>
    </dl>}
  </li>;
}
