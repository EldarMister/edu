import type { ProductStats } from '../api';

type ProductAmounts = Pick<ProductStats, 'quantity' | 'revenue' | 'cost' | 'profit'>;

const plusKnown = (left: number | null, right: number | null) => left == null || right == null ? null : left + right;

export function productSalesMetrics({ quantity, revenue, cost, profit }: ProductAmounts) {
  return {
    averagePrice: quantity > 0 ? revenue / quantity : null,
    averageCost: quantity > 0 && cost != null ? cost / quantity : null,
    foodCost: revenue > 0 && cost != null ? 100 * cost / revenue : null,
    markup: cost != null && cost > 0 && profit != null ? 100 * profit / cost : null,
  };
}

export function groupProductSales(rows: readonly ProductStats[], showVariants: boolean, showWaiters: boolean) {
  const grouped = new Map<string, ProductStats>();
  for (const row of rows) {
    const productKey = (showVariants ? row.variantKey : row.productKey) ?? row.id;
    const id = showWaiters ? JSON.stringify([productKey, row.waiterId]) : productKey;
    const cost = row.costBasis ?? row.cost;
    const profit = row.profitBasis ?? row.profit;
    const previous = grouped.get(id);
    if (!previous) {
      grouped.set(id, { ...row, id, cost, profit, name: showVariants ? row.name : row.baseName ?? row.name });
      continue;
    }
    previous.quantity += row.quantity;
    previous.gross += row.gross;
    previous.discount += row.discount;
    previous.revenue += row.revenue;
    previous.cost = plusKnown(previous.cost, cost);
    previous.profit = plusKnown(previous.profit, profit);
  }
  return [...grouped.values()].map((row) => ({ ...row, ...productSalesMetrics(row) }));
}
