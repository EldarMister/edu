import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { warehouseDateRange } from './report-range';
import { WarehouseReportQuery, WarehouseReportView } from './reports.dto';
import { resolveWarehouse, warehouseDocumentFilter, warehouseBalances } from './warehouse-location';
import { normalizeUnit, unitDef, unitLabel } from './units';
import { preparedLossQuantity, warehouseLossFilter } from './movement-cost';
import { movementSummary } from './movement-summary';

type ReportRow = {
  id: string; createdAt: Date | null; ingredientId: string; ingredientName: string;
  category: string | null; warehouseId: string | null; warehouseName: string;
  quantity: number; unit: string; unitCost: number | null; totalCost: number | null; valuationAdjustment: number; costKnown: boolean;
  sourceType: string | null; sourceId: string | null; documentLabel: string | null;
  employeeId: string | null; employeeName: string | null; reason: string | null; type: string;
};
type InternalRow = ReportRow & { exactCost: Prisma.Decimal; exactAdjustment: Prisma.Decimal };
const zero = new Prisma.Decimal(0);

@Injectable()
export class WarehouseReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: WarehouseReportQuery) {
    return this.prisma.$transaction((tx) => this.readReport(tx, query), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async readReport(db: Prisma.TransactionClient, query: WarehouseReportQuery) {
    if (query.view === 'movement_summary') {
      const summary = await movementSummary(db, query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 100;
      return { ...summary, view: query.view, page, pageSize, totalRows: summary.rows.length,
        totalCost: summary.closingValue, salesPerformance: null,
        rows: summary.rows.slice((page - 1) * pageSize, page * pageSize) };
    }
    const rows = await this.rows(db, query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const totalCost = rows.reduce((sum, row) => sum.add(row.exactCost), zero);
    const salesPerformance = query.view === 'sales' && !query.warehouseId && !query.ingredientId && !query.category && !query.search && !query.type && !query.kind
      ? await this.salesPerformance(query, db) : null;
    return {
      view: query.view ?? 'movements', page, pageSize, totalRows: rows.length,
      totalCost: rows.every((row) => row.costKnown) ? Number(totalCost.toDecimalPlaces(2)) : null,
      totalValuationAdjustment: Number(rows.reduce((sum, row) => sum.add(row.exactAdjustment), zero).toDecimalPlaces(2)),
      salesPerformance,
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map(({ exactCost, exactAdjustment, ...row }) => row),
    };
  }

  /** Revenue belongs to a whole check, so no artificial allocation to ingredient or warehouse filters.
   * Actual costs come exclusively from the immutable order movements, not today's recipe. */
  private async salesPerformance(query: WarehouseReportQuery, db: Prisma.TransactionClient = this.prisma) {
    const cafeId = getCafeId();
    const period = warehouseDateRange(query.from, query.to);
    const orders = await db.order.findMany({ where: { cafeId,
      OR: [{ status: 'paid' }, { paymentStatus: 'refunded' }],
      ...(period ? { closedAt: period } : {}), ...(query.employeeId ? { waiterId: query.employeeId } : {}),
    }, select: { id: true, paymentStatus: true, finalAmount: true, serviceChargeAmount: true,
      payments: { select: { amount: true, status: true } },
      items: { where: { status: { notIn: ['cancelled', 'rejected'] } }, select: { id: true, stockSourceLineId: true, stockAccountingSnapshot: true } },
    } });
    const movements = orders.length ? await db.stockMovement.findMany({ where: {
      cafeId, sourceType: 'order', sourceId: { in: orders.map(({ id }) => id) }, type: { in: ['sale', 'return', 'writeoff'] },
    } }) : [];
    let revenue = zero;
    for (const order of orders) {
      const paid = order.payments.length ? order.payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum.add(payment.amount), zero)
        : order.paymentStatus === 'refunded' ? zero : order.finalAmount;
      const merchandise = Prisma.Decimal.max(order.finalAmount.sub(order.serviceChargeAmount), 0);
      const retained = order.finalAmount.gt(0) ? Prisma.Decimal.min(paid.div(order.finalAmount), 1) : zero;
      revenue = revenue.add(merchandise.mul(retained));
    }
    const cost = movements.reduce((sum, movement) => sum.sub(movement.change.mul(movement.costAtMoment))
      .sub(preparedLossQuantity(movement).mul(movement.costAtMoment)), zero);
    const covered = new Set(movements.filter((movement) => movement.type === 'sale').map((movement) => movement.orderItemId));
    const missingCostLines = orders.reduce((sum, order) => sum + order.items.filter((item) => {
      const snapshot = item.stockAccountingSnapshot && typeof item.stockAccountingSnapshot === 'object' && !Array.isArray(item.stockAccountingSnapshot)
        ? item.stockAccountingSnapshot as Prisma.JsonObject : null;
      // A set can contain both configured and missing components. A movement for
      // just one component does not make its whole selling price fully costed.
      if (Array.isArray(snapshot?.warnings) && snapshot.warnings.length) return true;
      const knownEmpty = snapshot?.consumed === false && Array.isArray(snapshot.warnings) && !snapshot.warnings.length && !snapshot.legacyRecorded;
      return !knownEmpty && !covered.has(item.stockSourceLineId ?? item.id);
    }).length, 0);
    // A fully returned portion contributes no sales cost, even if its original
    // valuation was unknown. Match reversals to their original cycle and route:
    // a return from another warehouse or a later reopening cannot clear it.
    const consumption = new Map<string, { sold: Prisma.Decimal; released: Prisma.Decimal; unknown: boolean }>();
    for (const movement of movements) {
      const origin = movement.type === 'sale' ? movement.orderItemId : movement.saleLineId ?? movement.orderItemId;
      const key = JSON.stringify([movement.sourceId, origin, movement.ingredientId, movement.saleCycle, movement.warehouseKey]);
      const entry = consumption.get(key) ?? { sold: zero, released: zero, unknown: false };
      if (movement.type === 'sale') {
        entry.sold = entry.sold.sub(movement.change);
        entry.unknown ||= !movement.costKnown;
      } else if (movement.type === 'return') entry.released = entry.released.add(Prisma.Decimal.max(movement.change, 0));
      else entry.released = entry.released.add(preparedLossQuantity(movement));
      consumption.set(key, entry);
    }
    const unknownPriceLines = [...consumption.values()].filter((entry) => entry.unknown && entry.sold.gt(entry.released)).length;
    const complete = !missingCostLines && !unknownPriceLines;
    return { ordersCount: orders.length, netRevenue: Number(revenue.toDecimalPlaces(2)), actualCost: complete ? Number(cost.toDecimalPlaces(2)) : null,
      grossMargin: complete ? Number(revenue.sub(cost).toDecimalPlaces(2)) : null,
      marginPercent: complete && revenue.gt(0) ? Number(revenue.sub(cost).div(revenue).mul(100).toDecimalPlaces(2)) : null,
      foodCostPercent: complete && revenue.gt(0) ? Number(cost.div(revenue).mul(100).toDecimalPlaces(2)) : null,
      missingCostLines, unknownPriceLines, complete,
      note: 'Оплаченные чеки по дате закрытия, после скидок и возвратов, без платы за обслуживание. Маржа до зарплаты, аренды и прочих расходов.',
    };
  }

  async exportCsv(query: WarehouseReportQuery) {
    return this.prisma.$transaction((tx) => this.readCsv(tx, query), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async readCsv(db: Prisma.TransactionClient, query: WarehouseReportQuery) {
    if (query.view === 'movement_summary') {
      const summary = await movementSummary(db, query);
      const lines = [['Товар', 'Тип', 'Категория', 'Склад', 'Ед.', 'Начальный остаток', 'Себестоимость на начало', 'Начальная сумма',
        'Поступления', 'Расход', 'Конечный остаток', 'Себестоимость на конец', 'Конечная сумма', 'Корректировка оценки']];
      for (const row of summary.rows) lines.push([row.name, row.kind, row.category ?? '', row.warehouseName, row.unit,
        row.openingQuantity, row.openingAvgCost, row.openingValue, row.incomingQuantity, row.outgoingQuantity,
        row.closingQuantity, row.closingAvgCost, row.closingValue, row.valuationAdjustment].map((value) => value === null ? '' : String(value)));
      return '\uFEFF' + lines.map((line) => line.map(csvCell).join(';')).join('\r\n');
    }
    const rows = await this.rows(db, query);
    const lines = [['Дата', 'Товар', 'Категория', 'Склад', 'Количество', 'Ед.', 'Стоимость единицы, сом',
      'Сумма, сом', 'Корректировка оценки, сом', 'Документ', 'Сотрудник', 'Причина', 'ID документа']];
    for (const row of rows) lines.push([
      row.createdAt?.toISOString() ?? '', row.ingredientName, row.category ?? '', row.warehouseName,
      String(row.quantity), row.unit, row.unitCost == null ? '' : String(row.unitCost), row.totalCost == null ? '' : String(row.totalCost), String(row.valuationAdjustment), row.documentLabel ?? '',
      row.employeeName ?? '', row.reason ?? '', row.sourceId ?? '',
    ]);
    return '\uFEFF' + lines.map((line) => line.map(csvCell).join(';')).join('\r\n');
  }

  private async rows(db: Prisma.TransactionClient, query: WarehouseReportQuery): Promise<InternalRow[]> {
    const cafeId = getCafeId();
    if (!cafeId) throw new BadRequestException('Заведение не назначено');
    const view = query.view ?? 'movements';
    const period = warehouseDateRange(query.from, query.to);
    const warehouse = query.warehouseId ? await resolveWarehouse(db, query.warehouseId) : null;
    const locations = await db.warehouse.findMany({ where: { cafeId } });
    const names = new Map(locations.map((location) => [location.id, location.name]));
    const defaultWarehouse = locations.find((location) => location.isDefault);
    const ingredientFilter: Prisma.IngredientWhereInput = {
      cafeId, ...(query.ingredientId ? { id: query.ingredientId } : {}),
      ...(query.search ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    };
    if (view === 'balances') {
      const ingredients = await db.ingredient.findMany({
        where: { ...ingredientFilter, isActive: true, preparationMode: { not: 'virtual' } }, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      const rows: InternalRow[] = [];
      // A separate row per warehouse preserves each location's valuation.
      for (const location of warehouse ? [warehouse] : locations) {
        const balances = await warehouseBalances(db, location, ingredients);
        for (const ingredient of ingredients) {
          const balance = balances.get(ingredient.id)!;
          const unit = normalizeUnit(ingredient.displayUnit);
          rows.push({
            id: `${location.id}:${ingredient.id}`, createdAt: null, ingredientId: ingredient.id,
            ingredientName: ingredient.name, category: ingredient.category, warehouseId: location.id,
            warehouseName: location.name, quantity: Number(balance.stock.div(unitDef(unit).factor)), unit: unitLabel(unit),
            unitCost: balance.valuationKnown ? Number(balance.avgCost.mul(unitDef(unit).factor).toDecimalPlaces(8)) : null,
            totalCost: balance.valuationKnown || balance.stock.isZero() ? Number(balance.stockValue.toDecimalPlaces(2)) : null, exactCost: balance.stockValue,
            costKnown: balance.valuationKnown || balance.stock.isZero(),
            valuationAdjustment: 0, exactAdjustment: zero,
            sourceType: null, sourceId: null, documentLabel: 'Текущий остаток', employeeId: null, employeeName: null,
            reason: null, type: 'balance',
          });
        }
      }
      return rows;
    }
    if (query.type && !Object.values(StockMovementType).includes(query.type as StockMovementType)) {
      throw new BadRequestException('Неизвестный тип движения');
    }
    const where: Prisma.StockMovementWhereInput = {
      cafeId, ...warehouseDocumentFilter(warehouse), ingredient: ingredientFilter,
      ...(period ? { createdAt: period } : {}),
      AND: [viewFilter(view), ...(query.type ? [{ type: query.type as StockMovementType }] : [])],
    };
    const movements = await db.stockMovement.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { ingredient: true },
    });
    const sourceIds = [...new Set(movements.flatMap((movement) => movement.sourceId ? [movement.sourceId] : []))];
    const [documents, purchases, orders] = sourceIds.length ? await Promise.all([
      db.warehouseDocument.findMany({ where: { cafeId, id: { in: sourceIds } } }),
      db.purchase.findMany({ where: { cafeId, id: { in: sourceIds } }, select: { id: true, number: true, supplier: true } }),
      db.order.findMany({ where: { cafeId, id: { in: sourceIds } }, select: {
        id: true, orderNumber: true, waiterId: true, waiter: { select: { name: true } },
      } }),
    ]) : [[], [], []];
    const documentMap = new Map(documents.map((document) => [document.id, document]));
    const purchaseMap = new Map(purchases.map((purchase) => [purchase.id, purchase]));
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    return movements.map((movement): InternalRow => {
      const document = movement.sourceId ? documentMap.get(movement.sourceId) : undefined;
      const purchase = movement.sourceId ? purchaseMap.get(movement.sourceId) : undefined;
      const order = movement.sourceId ? orderMap.get(movement.sourceId) : undefined;
      const unit = normalizeUnit(movement.ingredient.displayUnit);
      const signedValue = movement.change.mul(movement.costAtMoment);
      const loss = preparedLossQuantity(movement).mul(movement.costAtMoment);
      const exactCost = view === 'losses' ? signedValue.neg().add(loss)
        : view === 'sales' ? signedValue.neg().sub(loss) : view === 'movements' ? signedValue.add(movement.valuationAdjustment) : signedValue;
      return {
        id: movement.id, createdAt: movement.createdAt, ingredientId: movement.ingredientId,
        ingredientName: movement.ingredient.name, category: movement.ingredient.category,
        warehouseId: movement.warehouseId ?? defaultWarehouse?.id ?? null,
        warehouseName: names.get(movement.warehouseId ?? '') ?? defaultWarehouse?.name ?? 'Основной склад',
        quantity: Number(movement.change.div(unitDef(unit).factor)), unit: unitLabel(unit),
        unitCost: movement.costKnown ? Number(movement.costAtMoment.mul(unitDef(unit).factor).toDecimalPlaces(8)) : null,
        totalCost: movement.costKnown ? Number(exactCost.toDecimalPlaces(2)) : null, exactCost, sourceType: movement.sourceType,
        costKnown: movement.costKnown,
        valuationAdjustment: Number(movement.valuationAdjustment), exactAdjustment: movement.valuationAdjustment,
        sourceId: movement.sourceId,
        documentLabel: loss.gt(0) ? `Потери готового блюда · ${order ? `Заказ №${order.orderNumber}` : 'Заказ'}`
          : document ? documentName(document.kind) : purchase ? `Поставка №${purchase.number}`
          : movement.sourceType === 'processing' ? 'Переработка' : movement.sourceType === 'production' ? 'Производство'
          : order ? `Заказ №${order.orderNumber}` : movement.comment ?? 'Движение склада',
        employeeId: movement.actorId ?? document?.postedById ?? order?.waiterId ?? null,
        employeeName: movement.actorName ?? document?.postedByName ?? order?.waiter?.name ?? null,
        reason: movement.reason ?? document?.reason ?? movement.comment, type: movement.type,
      };
    }).filter((row) => !query.employeeId || row.employeeId === query.employeeId);
  }
}

function viewFilter(view: WarehouseReportView): Prisma.StockMovementWhereInput {
  if (view === 'purchases') return { sourceType: { in: ['purchase', 'supplier_return'] } };
  if (view === 'sales') return { sourceType: 'order', type: { in: ['sale', 'return', 'writeoff'] } };
  if (view === 'variances') return { sourceType: 'inventory' };
  if (view === 'losses') return warehouseLossFilter;
  return {};
}

function documentName(kind: string) {
  return ({ inventory: 'Инвентаризация', writeoff: 'Списание', transfer: 'Перемещение', supplier_return: 'Возврат поставщику' } as Record<string, string>)[kind] ?? 'Складской документ';
}

export function csvCell(value: string) {
  // Prevent names/comments becoming executable formulas when opened in Excel.
  const safe = /^[\s]*[=+@-]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
