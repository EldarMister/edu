import { Prisma } from '@prisma/client';
import { historicalCostRoutes, historicalCosts, orderProductSales, statisticsMovementSelect, statisticsOrderSelect } from '../admin/statistics-reports';
import { netOrderAmount } from '../orders/order-net';
import { warehouseMoneyFormat, writeWarehouseWorkbook } from '../warehouse/warehouse-register-xlsx';

type Amount = number | null;
type Period = { from: Date; to: Date };
const plus = (a: Amount, b: Amount): Amount => a == null || b == null ? null : a + b;
const minus = (a: Amount, b: Amount): Amount => a == null || b == null ? null : a - b;
const rounded = (value: Amount) => value == null ? null : new Prisma.Decimal(value).toDecimalPlaces(2).toNumber();

export async function readProfitLoss(db: Prisma.TransactionClient, cafeId: string, bounds: Period) {
  const range = { gte: bounds.from, lt: bounds.to };
  const [stock, ledger] = await Promise.all([
    db.$queryRaw<{ source: string; value: Prisma.Decimal | null }[]>`
      SELECT CASE WHEN m.source_type = 'writeoff' AND (r.expense OR d.reason = ANY(s.expense_writeoff_reasons))
                  THEN 'expense' ELSE m.source_type::text END AS source,
             CASE WHEN BOOL_AND(m.cost_known) THEN SUM(-m.change * m.cost_at_moment) END AS value
      FROM stock_movements m LEFT JOIN warehouse_documents d ON d.cafe_id = m.cafe_id AND d.id = m.source_id
      LEFT JOIN writeoff_reasons r ON r.cafe_id = d.cafe_id AND r.id = d.writeoff_reason_id
      LEFT JOIN settings s ON s.cafe_id = m.cafe_id
      WHERE m.cafe_id = ${cafeId} AND m.source_type IN ('inventory', 'writeoff') AND m.change <> 0
        AND m.created_at >= (${bounds.from} AT TIME ZONE 'UTC') AND m.created_at < (${bounds.to} AT TIME ZONE 'UTC')
      GROUP BY 1`,
    db.$queryRaw<{ kind: string; category: string; amount: Prisma.Decimal }[]>`
      SELECT e.kind::text, COALESCE(c.name, CASE WHEN e.kind = 'salary' THEN 'Зарплата' ELSE 'Без категории' END) AS category,
        SUM(e.amount) AS amount
      FROM finance_entries e LEFT JOIN finance_categories c ON c.id = e.category_id AND c.cafe_id = e.cafe_id
      LEFT JOIN purchases p ON p.id = e.purchase_id AND p.cafe_id = e.cafe_id
      WHERE e.cafe_id = ${cafeId} AND COALESCE(c.show_in_profit_loss, true) AND e.kind IN ('income', 'expense', 'salary')
        AND e.cash_custodian_id IS NULL AND NOT e.pending_cash_shift
        AND COALESCE(e.source_key, '') NOT LIKE 'cash-handover:%'
        AND COALESCE(e.source_key, '') NOT LIKE 'void:%'
        AND NOT EXISTS (SELECT 1 FROM finance_entries v WHERE v.cafe_id = e.cafe_id AND v.source_key = 'void:' || e.id)
        AND COALESCE(p.effective_at, p.date, e.deal_date::timestamp - INTERVAL '6 hours', e.occurred_at) >= (${bounds.from} AT TIME ZONE 'UTC')
        AND COALESCE(p.effective_at, p.date, e.deal_date::timestamp - INTERVAL '6 hours', e.occurred_at) < (${bounds.to} AT TIME ZONE 'UTC')
      GROUP BY e.kind, category ORDER BY category, e.kind`,
  ]);
  let itemSales = 0, receipts = 0, tax = 0;
  const taxes = new Map<string, number>();
  let itemCost: Amount = 0;
  let afterId: string | undefined;
  for (;;) {
    const checks = await db.order.findMany({ where: { cafeId, status: 'paid', closedAt: range, id: { gt: afterId } },
      take: 2000, orderBy: { id: 'asc' }, select: { ...statisticsOrderSelect,
        taxes: { ...statisticsOrderSelect.taxes, select: { ...statisticsOrderSelect.taxes.select, name: true, rate: true } } } });
    if (!checks.length) break;
    afterId = checks[checks.length - 1].id;
    const movements = await db.stockMovement.findMany({ where: { cafeId, sourceType: 'order',
      type: { in: ['sale', 'return', 'writeoff'] }, sourceId: { in: checks.map(({ id }) => id) } }, select: statisticsMovementSelect });
    const costs = historicalCosts(historicalCostRoutes(movements));
    for (const order of checks) {
      const { lines, totalTax, taxByRate } = orderProductSales(order, costs, true);
      const payable = netOrderAmount(order).toNumber();
      receipts += payable;
      tax += totalTax;
      for (const rate of order.taxes) {
        const amount = taxByRate.get(rate.taxId);
        if (amount == null) continue;
        const label = rate.name + ' (' + rate.rate.toString() + '%)';
        taxes.set(label, (taxes.get(label) ?? 0) + amount);
        taxByRate.delete(rate.taxId);
      }
      if (!lines.length && payable > 0) { itemSales += payable; itemCost = null; }
      for (const line of lines) {
        itemSales += line.revenue;
        if (line.quantity || line.revenue || line.cost) itemCost = plus(itemCost, line.cost);
      }
    }
    if (checks.length < 2000) break;
  }
  let inventory: Amount = 0, writeoffs: Amount = 0, writtenOffToExpenses: Amount = 0;
  for (const group of stock) {
    const value = group.value?.toNumber() ?? null;
    if (group.source === 'inventory') inventory = value;
    else if (group.source === 'expense') writtenOffToExpenses = value;
    else writeoffs = value;
  }
  const incomeRows = ledger.filter((entry) => entry.kind === 'income');
  const expenseRows = ledger.filter((entry) => entry.kind !== 'income');
  const income = receipts + incomeRows.reduce((total, row) => total + row.amount.toNumber(), 0);
  const expenses = plus(writtenOffToExpenses, expenseRows.reduce((total, row) => total - row.amount.toNumber(), 0));
  const cost = plus(plus(itemCost, inventory), writeoffs);
  const beforeTax = minus(minus(income, cost), expenses);
  const rows: { label: string; value: Amount; percent: Amount; detail: boolean }[] = [];
  function row(label: string, amount: Amount, detail = false) {
    const value = rounded(amount);
    if (detail && value === 0) return;
    rows.push({ label, value, percent: value != null && income > 0 ? rounded(value * 100 / income) : null, detail });
  }
  row('Доходы', income);
  row('Продажи товаров и техкарт', itemSales, true);
  row('Обслуживание', receipts - itemSales, true);
  for (const entry of incomeRows) row(entry.category, entry.amount.toNumber(), true);
  row('Себестоимость', cost);
  row('Себестоимость продаж', itemCost, true);
  row('Результат инвентаризаций', inventory, true);
  row('Складские списания', writeoffs, true);
  row('Маржа от продаж', minus(itemSales, itemCost));
  row('Расходы', expenses);
  row('Списания на расходы', writtenOffToExpenses, true);
  for (const entry of expenseRows) row(entry.category, -entry.amount.toNumber(), true);
  row('Прибыль до налогообложения', beforeTax);
  row('Налоги с продаж', tax);
  for (const [label, amount] of taxes) row(label, amount, true);
  row('Прибыль после налогообложения', minus(beforeTax, tax));
  return { rows };
}

export function profitLossWorkbook(report: Awaited<ReturnType<typeof readProfitLoss>>, from: string, to: string) {
  return writeWarehouseWorkbook([{ name: 'P&L', columns: [
    { label: 'Статья', width: 42 }, { label: 'Сумма', width: 19, format: warehouseMoneyFormat },
    { label: 'Доля дохода', width: 19, format: '0.00"%"' },
  ], rows: [[from + ' — ' + to, null, null], ...report.rows.map((row) => [row.label, row.value, row.percent])] }]);
}
