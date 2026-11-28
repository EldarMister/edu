import { BadRequestException, Injectable } from '@nestjs/common';
import { netOrderAmount, netPaymentAmount } from '../orders/order-net';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { warehouseDateRange } from './report-range';
import { reportIngredientFilters } from './report-ingredient-filters';
import { FoodCostReportQuery, WarehouseMovementExportQuery, WarehouseReportQuery, WarehouseReportView } from './reports.dto';
import { readFoodCostReport } from './food-cost-report';
import { warehouseBalances } from './warehouse-location';
import { reportWarehouses } from './report-warehouses';
import { internalTransferLegs } from './report-transfer-flow';
import { adjustsPurchaseReceipt, historicalPurchaseCorrection, historicalPurchaseValue } from './purchase-correction';
import { normalizeUnit, unitDef, unitLabel } from './units';
import { preparedLossQuantity, warehouseLossFilter } from './movement-cost';
import { movementSummary } from './movement-summary';
import { movementExportColumns, writeMovementWorkbook } from './movement-report-xlsx';

type ReportRow = {
  id: string; createdAt: Date | null; ingredientId: string; ingredientName: string;
  category: string | null; warehouseId: string | null; warehouseName: string;
  quantity: number; unit: string; unitCost: number | null; totalCost: number | null; valuationAdjustment: number; costKnown: boolean;
  sourceType: string | null; sourceId: string | null; documentLabel: string | null;
  employeeId: string | null; employeeName: string | null; reason: string | null; type: string;
};
type InternalRow = ReportRow & { exactQuantity: Prisma.Decimal; exactCost: Prisma.Decimal; exactAdjustment: Prisma.Decimal;
  receiptCorrection?: Prisma.Decimal; exactReceiptValue?: Prisma.Decimal };
const zero = new Prisma.Decimal(0);

@Injectable()
export class WarehouseReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: WarehouseReportQuery) {
    return this.prisma.$transaction((tx) => this.readReport(tx, query), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  foodCost(query: FoodCostReportQuery) {
    return this.prisma.$transaction((tx) => readFoodCostReport(tx, query), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000,
    });
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
    const ingredientFilters = reportIngredientFilters(query);
    const salesPerformance = query.view === 'sales' && !query.warehouseId && !query.warehouseIds
      && !query.ingredientId && !ingredientFilters.category && !ingredientFilters.kind && !query.search && !query.type
      ? await this.salesPerformance(query, db) : null;
    return {
      view: query.view ?? 'movements', page, pageSize, totalRows: rows.length,
      totalCost: rows.every((row) => row.costKnown) ? Number(totalCost.toDecimalPlaces(2)) : null,
      totalValuationAdjustment: Number(rows.reduce((sum, row) => sum.add(row.exactAdjustment), zero).toDecimalPlaces(2)),
      salesPerformance,
      ...((query.view ?? 'movements') === 'movements' && query.ingredientId
        ? { movementGroups: groupMovements(rows) } : {}),
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map(({ exactQuantity, exactCost, exactAdjustment, receiptCorrection, exactReceiptValue, ...row }) => row),
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
    }, select: { id: true, paymentStatus: true, finalAmount: true, refundedAmount: true, serviceChargeAmount: true, deliveryFee: true,
      payments: { select: { amount: true, status: true, refundedAmount: true } },
      items: { where: { status: { notIn: ['cancelled', 'rejected'] } }, select: { id: true, stockSourceLineId: true, stockAccountingSnapshot: true } },
    } });
    const movements = orders.length ? await db.stockMovement.findMany({ where: {
      cafeId, sourceType: 'order', sourceId: { in: orders.map(({ id }) => id) }, type: { in: ['sale', 'return', 'writeoff'] },
    } }) : [];
    let revenue = zero;
    for (const order of orders) {
      const paid = order.payments.length ? order.payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum.add(netPaymentAmount(payment)), zero)
        : order.paymentStatus === 'refunded' ? zero : netOrderAmount(order);
      const merchandise = Prisma.Decimal.max(order.finalAmount.sub(order.serviceChargeAmount).sub(order.deliveryFee), 0);
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

  async exportMovementXlsx(query: WarehouseMovementExportQuery) {
    if (query.view && query.view !== 'movement_summary') {
      throw new BadRequestException('Экспорт в Excel доступен для отчёта по движению');
    }
    const columns = movementExportColumns(query.columns);
    const summary = await this.prisma.$transaction((tx) => movementSummary(tx, query),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return writeMovementWorkbook(summary.rows, columns);
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
    const scope = await reportWarehouses(db, query);
    const names = new Map(scope.locations.map((location) => [location.id, location.name]));
    const ingredientFilter: Prisma.IngredientWhereInput = {
      cafeId, ...(query.ingredientId ? { id: query.ingredientId } : {}),
      ...(query.search ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
      ...reportIngredientFilters(query),
    };
    if (view === 'balances') {
      const ingredients = await db.ingredient.findMany({
        where: { ...ingredientFilter, isActive: true, preparationMode: { not: 'virtual' } }, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      const rows: InternalRow[] = [];
      // A separate row per warehouse preserves each location's valuation.
      for (const location of scope.selected) {
        const balances = await warehouseBalances(db, location, ingredients);
        for (const ingredient of ingredients) {
          const balance = balances.get(ingredient.id)!;
          const unit = normalizeUnit(ingredient.displayUnit);
          rows.push({
            id: `${location.id}:${ingredient.id}`, createdAt: null, ingredientId: ingredient.id,
            ingredientName: ingredient.name, category: ingredient.category, warehouseId: location.id,
            warehouseName: location.name, quantity: Number(balance.stock.div(unitDef(unit).factor)), unit: unitLabel(unit),
            exactQuantity: balance.stock.div(unitDef(unit).factor),
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
      cafeId, ...scope.filter, ingredient: ingredientFilter,
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
      const bookChange = signedValue.add(movement.valuationAdjustment);
      const receiptCorrection = historicalPurchaseCorrection(movement) ? historicalPurchaseValue(movement)
        : adjustsPurchaseReceipt(movement) ? bookChange : undefined;
      const costKnown = movement.costKnown || (view === 'purchases' && receiptCorrection !== undefined);
      const exactCost = view === 'losses' ? signedValue.neg().add(loss)
        : view === 'sales' ? signedValue.neg().sub(loss) : view === 'movements' ? bookChange
        : receiptCorrection ?? movement.receiptValue ?? signedValue;
      return {
        id: movement.id, createdAt: movement.createdAt, ingredientId: movement.ingredientId,
        ingredientName: movement.ingredient.name, category: movement.ingredient.category,
        warehouseId: movement.warehouseId ?? scope.defaultWarehouse?.id ?? null,
        warehouseName: names.get(movement.warehouseId ?? '') ?? scope.defaultWarehouse?.name ?? 'Основной склад',
        quantity: Number(movement.change.div(unitDef(unit).factor)), unit: unitLabel(unit),
        exactQuantity: movement.change.div(unitDef(unit).factor),
        unitCost: movement.costKnown ? Number(movement.costAtMoment.mul(unitDef(unit).factor).toDecimalPlaces(8)) : null,
        totalCost: costKnown ? Number(exactCost.toDecimalPlaces(2)) : null, exactCost, sourceType: movement.sourceType,
        costKnown,
        valuationAdjustment: Number(movement.valuationAdjustment), exactAdjustment: movement.valuationAdjustment,
        sourceId: movement.sourceId, receiptCorrection, exactReceiptValue: movement.receiptValue ?? undefined,
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

function groupMovements(rows: InternalRow[]) {
  // Quantities from different ingredients cannot form a meaningful unit price.
  if (new Set(rows.map((row) => row.ingredientId)).size > 1) return undefined;
  type Group = {
    direction: 'incoming' | 'outgoing'; sourceType: string; label: string; unit: string;
    quantity: Prisma.Decimal; cost: Prisma.Decimal; costKnown: boolean; count: number;
  };
  const groups = new Map<string, Group>();
  const internalLegs = internalTransferLegs(rows.map((row) => ({ ...row, quantity: row.exactQuantity })));
  for (const row of rows) {
    // Pure valuation and prepared-loss evidence does not move physical quantity.
    if ((!row.receiptCorrection && row.exactQuantity.isZero()) || internalLegs.has(row.id)) continue;
    const direction = row.receiptCorrection || row.exactQuantity.gt(0) ? 'incoming' : 'outgoing';
    const sourceType = row.sourceType ?? 'manual';
    const key = JSON.stringify([direction, sourceType, row.unit]);
    const group = groups.get(key) ?? {
      direction, sourceType, label: movementGroupLabel(sourceType, direction), unit: row.unit,
      quantity: zero, cost: zero, costKnown: true, count: 0,
    };
    group.quantity = group.quantity.add(row.receiptCorrection ? row.exactQuantity : row.exactQuantity.abs());
    // A historical invoice correction contributes the signed change to its
    // original receipt. Ordinary book adjustments do not reprice group totals.
    group.cost = group.cost.add(row.receiptCorrection ?? row.exactReceiptValue ?? row.exactCost.sub(row.exactAdjustment).abs());
    group.costKnown &&= row.receiptCorrection !== undefined || row.costKnown;
    if (!row.receiptCorrection) group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => !group.quantity.isZero())
    .sort((a, b) => a.direction.localeCompare(b.direction) || a.label.localeCompare(b.label, 'ru') || a.unit.localeCompare(b.unit))
    .map((group) => ({
      direction: group.direction, sourceType: group.sourceType, label: group.label,
      quantity: Number(group.quantity), unit: group.unit,
      averageCost: group.costKnown ? Number(group.cost.div(group.quantity).toDecimalPlaces(8)) : null,
      count: group.count,
    }));
}

function movementGroupLabel(sourceType: string, direction: 'incoming' | 'outgoing') {
  if (['inventory', 'writeoff', 'transfer', 'supplier_return'].includes(sourceType)) return documentName(sourceType);
  return ({
    purchase: 'Поставки', order: direction === 'incoming' ? 'Возвраты продаж' : 'Продажи',
    processing: 'Переработки', production: 'Производство', manual: 'Корректировки',
  } as Record<string, string>)[sourceType] ?? 'Движения склада';
}

export function csvCell(value: string) {
  // Prevent names/comments becoming executable formulas when opened in Excel.
  const safe = /^[\s]*[=+@-]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
