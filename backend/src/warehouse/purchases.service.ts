import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto, PurchaseItemInputDto, UpdatePurchaseDto } from './dto';
import { resolveWarehouseSupplier } from './suppliers';
import { purchaseUnitsFor } from './purchase-units';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { postStockMovement } from './stock-posting';
import { historicalPurchaseCorrectionReason, postPurchaseCorrection, purchaseCorrectionEligibility } from './purchase-correction';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients } from './stock-lock';
import { getWarehouseBalance, resolveWarehouse, warehouseDocumentFilter } from './warehouse-location';
import { assertUnitMatchesType, costToBase, fromBase, normalizeUnit, toBase, unitLabel, type UnitCode } from './units';
import { PurchaseExportQuery, PurchaseListQuery, purchaseDateRange } from './purchases-query.dto';
import { purchaseExportColumns, writePurchaseWorkbook } from './purchases-xlsx';
import { parseStockEffectiveAt } from './stock-effective-time';
import { receiptMovementValue, replayHistoricalStock } from './historical-stock-replay';

const postingTransaction = { timeout: 30_000 };

// Нормализованная позиция закупки: введённые (display) + базовые значения.
type NormalizedItem = {
  packageId?: string;
  packageName?: string;
  packageUnit?: string;
  packageQuantity?: Prisma.Decimal;
  packageFactor?: Prisma.Decimal;
  ingredientId: string;
  unit: string;
  quantity: Prisma.Decimal; // display
  purchasePrice: Prisma.Decimal; // за display-единицу
  total: Prisma.Decimal;
  grossTotal: Prisma.Decimal;
  quantityBase: Prisma.Decimal;
  unitPriceBase: Prisma.Decimal;
};

@Injectable()
export class PurchasesService {
  constructor(private prisma: PrismaService) {}

  private serializeItem(item: {
    id: string;
    ingredientId: string;
    unit: string;
    quantity: Prisma.Decimal;
    quantityBase: Prisma.Decimal;
    purchasePrice: Prisma.Decimal;
    total: Prisma.Decimal;
  grossTotal: Prisma.Decimal;
    ingredient?: { name: string } | null;
    packageId?: string | null; packageName?: string | null; packageUnit?: string | null;
    packageQuantity?: Prisma.Decimal | null; packageFactor?: Prisma.Decimal | null;
  }) {
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient?.name ?? '',
      packageId: item.packageId ?? null, packageName: item.packageName ?? null, packageUnit: item.packageUnit ?? null,
      packageQuantity: item.packageQuantity == null ? null : Number(item.packageQuantity), packageFactor: item.packageFactor == null ? null : Number(item.packageFactor),
      unit: this.unitLabel(item.unit), // кириллица для UI
      unitCode: item.unit as UnitCode, // код единицы — для форм редактирования
      quantity: Number(item.quantity),
      quantityBase: Number(item.quantityBase),
      purchasePrice: Number(item.purchasePrice),
      total: Number(item.total), grossTotal: Number(item.grossTotal),
    };
  }

  private serialize(p: any) {
    return {
      id: p.id,
      number: p.number,
      date: p.date,
      effectiveAt: p.effectiveAt,
      postedAt: p.stockPostedAt,
      supplier: p.supplier, supplierId: p.supplierId,
      warehouseId: p.warehouseId,
      totalAmount: Number(p.totalAmount), note: p.note, attachments: p.attachments ?? [], discount: Number(p.discount ?? 0),
      status: p.status as PurchaseStatus,
      itemsCount: p._count?.items ?? p.items?.length ?? 0,
      items: p.items ? p.items.map((i: any) => this.serializeItem(i)) : undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private async listWhere(db: Prisma.TransactionClient, params: PurchaseListQuery): Promise<Prisma.PurchaseWhereInput> {
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(db, params.warehouseId);
    const search = params.search?.trim();
    const numberMatch = search?.match(/^(?:ЗКП-)?(\d+)$/i);
    const number = numberMatch ? Number(numberMatch[1]) : NaN;
    const searchConditions: Prisma.PurchaseWhereInput[] = search ? [
      { supplier: { contains: search, mode: 'insensitive' } },
      { note: { contains: search, mode: 'insensitive' } },
      { items: { some: { ingredient: { name: { contains: search, mode: 'insensitive' } } } } },
      ...(Number.isInteger(number) && number > 0 && number <= 2147483647 ? [{ number }] : []),
    ] : [];
    const period = this.dateRange(params.from, params.to);
    return {
      ...warehouseDocumentFilter(warehouse),
      ...(params.status ? { status: params.status } : {}),
      ...(params.suppliers?.length ? { supplier: { in: params.suppliers } } : {}),
      ...(params.categories?.length ? { items: { some: { ingredient: { category: { in: params.categories } } } } } : {}),
      // The default warehouse already has an OR for legacy records without a warehouseId.
      AND: [...(searchConditions.length ? [{ OR: searchConditions }] : []), ...(period ? [period] : [])],
    };
  }

  private sortByOperationDate<T extends { date: Date; effectiveAt: Date | null; stockPostedAt: Date | null; number: number }>(rows: T[], direction?: 'asc' | 'desc') {
    if (!direction) return rows;
    const order = direction === 'asc' ? 1 : -1;
    return rows.sort((a, b) => order * ((a.effectiveAt ?? a.stockPostedAt ?? a.date).getTime() - (b.effectiveAt ?? b.stockPostedAt ?? b.date).getTime() || a.number - b.number));
  }

  async findAll(params: PurchaseListQuery) {
    const where = await this.listWhere(this.prisma, params);
    const purchases = await this.prisma.purchase.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        _count: { select: { items: true } },
        items: {
          take: 3,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { ingredient: { select: { name: true } } },
        },
      },
    });
    return this.sortByOperationDate(purchases, params.dateSort).map(({ items, ...purchase }) => ({
      ...this.serialize(purchase),
      productNames: [...new Set(items.map((item) => item.ingredient.name))],
    }));
  }

  async exportXlsx(params: PurchaseExportQuery) {
    const columns = purchaseExportColumns(params.columns);
    const data = await this.prisma.$transaction(async (tx) => {
      const where = await this.listWhere(tx, params);
      const purchases = await tx.purchase.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: {
        items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { ingredient: { select: { name: true, category: true } } } },
      } });
      const warehouses = await tx.warehouse.findMany({ select: { id: true, name: true, isDefault: true } });
      return { purchases, warehouses };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return writePurchaseWorkbook(this.sortByOperationDate(data.purchases, params.dateSort), new Map(data.warehouses.map(({ id, name }) => [id, name])),
      data.warehouses.find(({ isDefault }) => isDefault)?.name ?? 'Основной склад', columns);
  }

  async overview(params: { from?: string; to?: string; warehouseId?: string }) {
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(this.prisma, params.warehouseId);
    const period = this.dateRange(params.from, params.to);
    const where: Prisma.PurchaseWhereInput = {
      ...warehouseDocumentFilter(warehouse),
      status: PurchaseStatus.completed,
      ...(period ? { AND: [period] } : {}),
    };
    const completed = await this.prisma.purchase.findMany({
      where,
      select: { supplier: true, totalAmount: true },
    });
    const suppliers = new Set(completed.map((p) => p.supplier.trim().toLowerCase()));
    const sum = Number(completed.reduce((acc, p) => acc.add(p.totalAmount), new Prisma.Decimal(0)));
    return { count: completed.length, suppliers: suppliers.size, sum };
  }

  async findOne(id: string) {
    return this.prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({
      where: { id },
      include: { items: { include: { ingredient: { select: { name: true, displayUnit: true } } } } },
    });
    if (!purchase) throw new NotFoundException('Закупка не найдена');
    const completed = purchase.status === PurchaseStatus.completed;
    const warehouse = completed ? await resolveWarehouse(tx, purchase.warehouseId) : null;
    const eligibility = completed ? await purchaseCorrectionEligibility(tx, purchase, [warehouse])
      : { stockPostedAt: null, historicalAt: null, canCorrectStock: false, correctionBlockedReason: null };
    const returned = completed ? await tx.warehouseDocumentItem.groupBy({
      by: ['ingredientId'], where: { document: { sourcePurchaseId: id, kind: 'supplier_return', status: 'posted' } },
      _sum: { quantity: true },
    }) : [];
    const grouped = new Map<string, { name: string; unitCode: UnitCode; quantity: Prisma.Decimal }>();
    for (const item of completed ? purchase.items : []) {
      const previous = grouped.get(item.ingredientId);
      grouped.set(item.ingredientId, { name: item.ingredient.name, unitCode: normalizeUnit(item.ingredient.displayUnit),
        quantity: (previous?.quantity ?? new Prisma.Decimal(0)).add(item.quantityBase) });
    }
    const returnableItems = [...grouped].map(([ingredientId, item]) => {
      const returnedBase = returned.find((row) => row.ingredientId === ingredientId)?._sum.quantity ?? new Prisma.Decimal(0);
      const returnedQuantityBase = Number(returnedBase);
      const receivedQuantityBase = Number(item.quantity);
      const remainingQuantityBase = Number(Prisma.Decimal.max(0, item.quantity.sub(returnedBase)));
      return { ingredientId, name: item.name, unit: unitLabel(item.unitCode), unitCode: item.unitCode,
        receivedQuantity: fromBase(receivedQuantityBase, item.unitCode), returnedQuantity: fromBase(returnedQuantityBase, item.unitCode),
        remainingQuantity: fromBase(remainingQuantityBase, item.unitCode), receivedQuantityBase, returnedQuantityBase,
        remainingQuantityBase, remainingBase: remainingQuantityBase };
    });
    const history = await tx.stockMovement.findMany({
      where: { sourceType: 'purchase', sourceId: id, reason: { in: ['purchase_correction', historicalPurchaseCorrectionReason] },
        recipeSnapshot: { not: Prisma.DbNull } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const corrections = history.flatMap((movement) => {
      const snapshot = movement.recipeSnapshot as Prisma.JsonObject | null;
      return snapshot?.kind === 'purchase_correction' && snapshot.before && snapshot.after
        ? [{ id: movement.id, createdAt: movement.recordedAt ?? movement.createdAt,
        actorName: movement.actorName, reason: movement.comment, before: snapshot.before, after: snapshot.after }] : [];
    }).sort((a, b) => +b.createdAt - +a.createdAt || b.id.localeCompare(a.id));
    const postedAt = purchase.stockPostedAt ?? eligibility.stockPostedAt;
    return { ...this.serialize(purchase), canCorrectStock: eligibility.canCorrectStock, historicalStockCorrection: eligibility.historicalAt !== null,
      correctionBlockedReason: eligibility.correctionBlockedReason, stockPostedAt: postedAt, postedAt, returnableItems, corrections };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async lastPrices(params: { ingredientIds?: string; warehouseId?: string; excludePurchaseId?: string; before?: string }) {
    if (typeof params.ingredientIds !== 'string' || (params.excludePurchaseId !== undefined &&
      (typeof params.excludePurchaseId !== 'string' || params.excludePurchaseId.length > 160))) throw new BadRequestException('Некорректный фильтр поставок');
    const ids = [...new Set((params.ingredientIds ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 100 || ids.some((id) => id.length > 160)) throw new BadRequestException('Выберите от 1 до 100 продуктов');
    const cafeId = getCafeId();
    if (!cafeId) throw new BadRequestException('Заведение не назначено');
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(this.prisma, params.warehouseId);
    const warehouseSql = !warehouse ? Prisma.empty : warehouse.isDefault
      ? Prisma.sql`AND (p.warehouse_id = ${warehouse.id} OR p.warehouse_id IS NULL)` : Prisma.sql`AND p.warehouse_id = ${warehouse.id}`;
    const excludeSql = params.excludePurchaseId ? Prisma.sql`AND p.id <> ${params.excludePurchaseId}` : Prisma.empty;
    const before = parseStockEffectiveAt(params.before);
    const dateSql = before ? Prisma.sql`AND COALESCE(p.effective_at, p.date) <= (${before} AT TIME ZONE 'UTC')` : Prisma.empty;
    const prices = await this.prisma.$queryRaw<Array<{ ingredientId: string; unitCode: string; quantity: Prisma.Decimal;
      grossTotal: Prisma.Decimal; date: Date; purchaseId: string; supplier: string }>>(Prisma.sql`
      SELECT DISTINCT ON (pi.ingredient_id) pi.ingredient_id AS "ingredientId", i.display_unit AS "unitCode",
        SUM(pi.quantity_base) AS quantity, SUM(pi.quantity * pi.purchase_price) AS "grossTotal",
        COALESCE(p.effective_at, p.date) AS date, p.id AS "purchaseId", p.supplier
      FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id JOIN ingredients i ON i.id = pi.ingredient_id
      WHERE p.cafe_id = ${cafeId} AND i.cafe_id = ${cafeId} AND p.status = 'completed'
        AND pi.ingredient_id IN (${Prisma.join(ids)}) ${warehouseSql} ${excludeSql} ${dateSql}
      GROUP BY pi.ingredient_id, i.display_unit, p.id, p.date, p.effective_at, p.supplier, p.created_at
      ORDER BY pi.ingredient_id, COALESCE(p.effective_at, p.date) DESC, p.created_at DESC, p.id DESC
    `);
    return prices.map((row) => {
      const unitCode = normalizeUnit(row.unitCode);
      const quantity = fromBase(Number(row.quantity), unitCode);
      return { ingredientId: row.ingredientId, unit: unitLabel(unitCode), unitCode,
        unitPrice: quantity > 0 ? Number(new Prisma.Decimal(row.grossTotal).div(quantity).toDecimalPlaces(8)) : 0,
        date: row.date, purchaseId: row.purchaseId, supplier: row.supplier };
    });
  }

  async create(dto: CreatePurchaseDto, actor?: AuthUser) {
    const discount = new Prisma.Decimal(dto.discount ?? 0).toDecimalPlaces(2);
    this.validateDate(dto.date, dto.complete === true);
    this.validateAttachments(dto.attachments);
    const effectiveAt = parseStockEffectiveAt(dto.effectiveAt);
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    const purchaseId = await this.prisma.$transaction(async (tx) => {
      const cafeId = getCafeId();
      if (!cafeId) throw new BadRequestException('Заведение не назначено');
      if (dto.requestKey) {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`purchase-request:${cafeId}:${dto.requestKey}`}))) AS request_lock`;
        const previous = await tx.purchase.findUnique({ where: { cafeId_requestKey: { cafeId, requestKey: dto.requestKey } }, include: { items: true } });
        if (previous) {
          const lineKey = (item: { ingredientId: string; quantityBase: Prisma.Decimal; grossTotal: Prisma.Decimal }) => `${item.ingredientId}:${item.quantityBase}:${item.grossTotal}`;
          if (previous.warehouseId !== (warehouse?.id ?? null) || !previous.discount.eq(discount)
            || previous.effectiveAt?.getTime() !== effectiveAt?.getTime()
            || (dto.supplierId ? previous.supplierId !== dto.supplierId : previous.supplier.trim().toLocaleLowerCase() !== dto.supplier?.trim().toLocaleLowerCase())
            || JSON.stringify(previous.items.map(lineKey).sort()) !== JSON.stringify(this.retryItems(dto.items, previous.items).map(lineKey).sort())) {
            throw new ConflictException('Ключ повторного запроса уже использован для другого прихода');
          }
          return previous.id;
        }
      }
      const items = this.discountItems(await this.normalizeItems(dto.items, tx), discount);
      const total = items.reduce((acc, item) => acc.add(item.total), new Prisma.Decimal(0));
      const supplier = await resolveWarehouseSupplier(tx, { ...dto, required: true });
      if (dto.complete) await lockIngredients(tx, items.map((item) => item.ingredientId));
      const purchase = await tx.purchase.create({
        data: {
          date: dto.date ? new Date(dto.date) : new Date(),
          effectiveAt,
          supplier: supplier.supplier!, supplierId: supplier.supplierId, requestKey: dto.requestKey, note: dto.note?.trim() || null, attachments: dto.attachments ?? [], discount,
          warehouseId: warehouse?.id ?? null,
          totalAmount: new Prisma.Decimal(total),
          items: { create: items.map((item) => this.itemCreateData(item)) },
        },
        include: { items: true },
      });
      if (dto.complete) await this.completePurchase(tx, purchase, actor);
      return purchase.id;
    }, postingTransaction);
    return this.findOne(purchaseId);
  }

  /** A retry is interpreted using the original unit snapshot, even after a
   * package is renamed, resized or archived. It never posts a second receipt. */
  private retryItems(items: PurchaseItemInputDto[], saved: Prisma.PurchaseItemGetPayload<{}>[]) {
    const normalized = (unit: string) => { try { return normalizeUnit(unit); } catch { return unit.trim().toLocaleLowerCase(); } };
    return (items ?? []).map((item) => {
      const original = saved.find((line) => line.ingredientId === item.ingredientId && (item.packageId
        ? line.packageId === item.packageId
        : !item.unit || normalized(line.unit) === normalized(item.unit)));
      if (!original || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
        (item.total == null ? !Number.isFinite(item.purchasePrice) || item.purchasePrice! < 0 : !Number.isFinite(item.total) || item.total < 0)) {
        throw new ConflictException('Ключ повторного запроса уже использован для другого прихода');
      }
      const quantity = new Prisma.Decimal(item.quantity).toDecimalPlaces(3);
      const factor = original.packageFactor ?? original.quantityBase.div(original.quantity);
      return { ingredientId: item.ingredientId, quantityBase: quantity.mul(factor).toDecimalPlaces(3),
        grossTotal: (item.total != null ? new Prisma.Decimal(item.total) : quantity.mul(item.purchasePrice!)).toDecimalPlaces(2) };
    });
  }

  async update(id: string, dto: UpdatePurchaseDto, actor?: AuthUser) {
    this.validateDate(dto.date);
    this.validateAttachments(dto.attachments);
    const effectiveAt = parseStockEffectiveAt(dto.effectiveAt);
    const warehouse = dto.warehouseId === undefined ? undefined : await resolveWarehouse(this.prisma, dto.warehouseId);

    await this.prisma.$transaction(async (tx) => {
      await this.lockPurchase(tx, id);
      const purchase = await tx.purchase.findUnique({ where: { id }, include: { items: { include: { ingredient: { select: { name: true } } } } } });
      if (!purchase) throw new NotFoundException('Закупка не найдена');
      if (purchase.status === PurchaseStatus.cancelled) throw new BadRequestException('Отменённую закупку нельзя редактировать');
      if (purchase.status === PurchaseStatus.completed) {
        if (effectiveAt !== undefined && effectiveAt?.getTime() !== purchase.effectiveAt?.getTime()) {
          throw new ConflictException('Складскую дату проведённой поставки нельзя менять');
        }
        return this.correctCompleted(tx, purchase, dto, actor);
      }
      const rawItems = dto.items ? await this.normalizeItems(dto.items, tx, purchase.items) : undefined;
      if (dto.discount !== undefined && !rawItems) throw new BadRequestException('Для изменения скидки передайте позиции прихода');
      const supplier = dto.supplier !== undefined || dto.supplierId !== undefined ? await resolveWarehouseSupplier(tx, { ...dto, required: true }) : undefined;
      const discount = new Prisma.Decimal(dto.discount ?? purchase.discount).toDecimalPlaces(2);
      const items = rawItems ? this.discountItems(rawItems, discount) : undefined;
      const total = items?.reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0));
      if (items) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        for (const item of items) {
          await tx.purchaseItem.create({ data: { purchaseId: id, ...this.itemCreateData(item) } });
        }
      }
      const updated = await tx.purchase.update({
        where: { id },
        data: {
          date: dto.date !== undefined ? new Date(dto.date) : undefined,
          effectiveAt,
          supplier: supplier?.supplier ?? undefined, supplierId: supplier?.supplierId, note: dto.note === undefined ? undefined : dto.note?.trim() || null,
          attachments: dto.attachments, discount,
          warehouseId: warehouse !== undefined ? warehouse?.id ?? null : undefined,
          totalAmount: total !== undefined ? new Prisma.Decimal(total) : undefined,
        },
        include: { items: true },
      });
      if (dto.complete) await this.completePurchase(tx, updated, actor);
    }, postingTransaction);
    return this.findOne(id);
  }

  private async correctCompleted(tx: Prisma.TransactionClient,
    purchase: Prisma.PurchaseGetPayload<{ include: { items: true } }>, dto: UpdatePurchaseDto, actor?: AuthUser) {
    if (!dto.expectedUpdatedAt || new Date(dto.expectedUpdatedAt).getTime() !== purchase.updatedAt.getTime()) {
      throw new ConflictException('Поставка изменилась. Обновите страницу перед исправлением.');
    }
    this.validateDate(dto.date ?? purchase.date.toISOString(), true);
    const previousWarehouse = await resolveWarehouse(tx, purchase.warehouseId);
    const nextWarehouse = dto.warehouseId === undefined ? previousWarehouse : await resolveWarehouse(tx, dto.warehouseId);
    const ids = [...new Set([...purchase.items.map((item) => item.ingredientId), ...(dto.items ?? []).map((item) => item.ingredientId)])];
    await lockIngredients(tx, ids);
    const normalized = dto.items ? await this.normalizeItems(dto.items, tx, purchase.items) : undefined;
    if (dto.discount !== undefined && !normalized) throw new BadRequestException('Для изменения скидки передайте позиции прихода');
    const discount = new Prisma.Decimal(dto.discount ?? purchase.discount).toDecimalPlaces(2);
    const items = normalized ? this.discountItems(normalized, discount) : undefined;
    const supplier = dto.supplier !== undefined || dto.supplierId !== undefined
      ? await resolveWarehouseSupplier(tx, { ...dto, required: true }) : undefined;
    const plans = new Map<string, { ingredientId: string; warehouse: typeof previousWarehouse; quantity: Prisma.Decimal; value: Prisma.Decimal }>();
    const add = (line: { ingredientId: string; quantityBase: Prisma.Decimal; total: Prisma.Decimal }, warehouse: typeof previousWarehouse, sign: number) => {
      const key = `${warehouse?.id ?? 'default'}:${line.ingredientId}`;
      const previous = plans.get(key);
      plans.set(key, { ingredientId: line.ingredientId, warehouse,
        quantity: (previous?.quantity ?? new Prisma.Decimal(0)).add(line.quantityBase.mul(sign)),
        value: (previous?.value ?? new Prisma.Decimal(0)).add(line.total.mul(sign)) });
    };
    purchase.items.forEach((item) => add(item, previousWarehouse, -1));
    (items ?? purchase.items).forEach((item) => add(item, nextWarehouse, 1));
    const stockChanges = [...plans.values()].filter((plan) => !plan.quantity.isZero() || !plan.value.isZero());
    let historicalAt: Date | null = null;
    if (stockChanges.length) {
      const eligibility = await purchaseCorrectionEligibility(tx, purchase, [previousWarehouse, nextWarehouse], ids);
      if (!eligibility.canCorrectStock) throw new ConflictException(eligibility.correctionBlockedReason!);
      historicalAt = eligibility.historicalAt;
      if (historicalAt) {
        const previousIds = new Set(purchase.items.map(({ ingredientId }) => ingredientId));
        const nextIds = new Set((items ?? purchase.items).map(({ ingredientId }) => ingredientId));
        if (previousWarehouse?.id !== nextWarehouse?.id
          || previousIds.size !== nextIds.size || [...previousIds].some((id) => !nextIds.has(id))) {
          throw new ConflictException('Историческое исправление возможно для существующих позиций на том же складе');
        }
        const returned = await tx.warehouseDocumentItem.groupBy({ by: ['ingredientId'],
          where: { document: { sourcePurchaseId: purchase.id, kind: 'supplier_return', status: 'posted' } },
          _sum: { quantity: true } });
        for (const row of returned) {
          const received = (items ?? purchase.items).filter((line) => line.ingredientId === row.ingredientId)
            .reduce((sum, line) => sum.add(line.quantityBase), new Prisma.Decimal(0));
          if (row._sum.quantity && received.lt(row._sum.quantity)) {
            throw new ConflictException('Количество в поставке не может быть меньше уже возвращённого поставщику');
          }
        }
        // Preserve the exact original value of legacy postings whose current
        // invoice items are about to be replaced.
        for (const original of eligibility.posted) {
          if (original.receiptValue != null) continue;
          const receiptValue = receiptMovementValue(original, purchase.items);
          await tx.stockMovement.update({ where: { id: original.id }, data: { receiptValue } });
        }
      }
    }
    const before = JSON.parse(JSON.stringify(this.serialize(purchase))) as Prisma.InputJsonValue;
    if (items) {
      await tx.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } });
      for (const item of items) await tx.purchaseItem.create({ data: { purchaseId: purchase.id, ...this.itemCreateData(item) } });
    }
    const updated = await tx.purchase.update({ where: { id: purchase.id }, data: {
      date: dto.date === undefined ? undefined : new Date(dto.date),
      supplier: supplier?.supplier ?? undefined, supplierId: supplier?.supplierId,
      note: dto.note === undefined ? undefined : dto.note?.trim() || null, attachments: dto.attachments,
      discount, warehouseId: nextWarehouse?.id ?? null,
      totalAmount: items?.reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0)),
      updatedAt: new Date(Math.max(Date.now(), purchase.updatedAt.getTime() + 1)),
    }, include: { items: { include: { ingredient: { select: { name: true } } } } } });
    const after = JSON.parse(JSON.stringify(this.serialize(updated))) as Prisma.InputJsonValue;
    const reason = dto.correctionReason?.trim() || 'Исправление поставки';
    const snapshot: Prisma.InputJsonValue = { kind: 'purchase_correction', version: 1, before, after };
    // A metadata-only correction is durable evidence with zero quantity/value change.
    const movements = stockChanges.length ? stockChanges : [{ ingredientId: purchase.items[0].ingredientId,
      warehouse: previousWarehouse, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) }];
    if (historicalAt && purchase.cafeId) {
      const recordedAt = new Date();
      const insertedMovementIds: string[] = [];
      for (const [index, plan] of movements.entries()) {
        const { movement } = await postStockMovement(tx, { ingredientId: plan.ingredientId, warehouse: plan.warehouse,
          change: plan.quantity, allowNegative: true,
          movement: { type: 'correction', sourceType: 'purchase', sourceId: purchase.id,
            createdAt: historicalAt, recordedAt, actorId: actor?.id, actorName: actor?.name,
            reason: historicalPurchaseCorrectionReason, comment: reason,
            recipeSnapshot: { kind: 'purchase_correction', version: 2, accounting: 'historical_replay',
              valueDelta: plan.value.toString(), ...(index === 0 ? { before, after } : {}) } },
        });
        insertedMovementIds.push(movement.id);
      }
      await replayHistoricalStock(tx, { cafeId: purchase.cafeId, effectiveAt: historicalAt, insertedMovementIds });
    } else {
      for (const [index, plan] of movements.entries()) await postPurchaseCorrection(tx, {
        purchaseId: purchase.id, ingredientId: plan.ingredientId, warehouse: plan.warehouse,
        quantityDelta: plan.quantity, valueDelta: plan.value, actor, reason, snapshot: index === 0 ? snapshot : undefined,
      });
    }
    await tx.auditLog.create({ data: { cafeId: purchase.cafeId, userId: actor?.id, userName: actor?.name, userRole: actor?.role,
      actionType: 'PURCHASE_CORRECTED', entityType: 'PURCHASE', entityId: purchase.id, description: reason,
      oldValue: before, newValue: after, metadata: { accounting: historicalAt ? 'historical_replay' : 'current_adjustment',
        historicalSalesRecalculated: historicalAt !== null, ...(historicalAt ? { effectiveAt: historicalAt.toISOString() } : {}) } } });
  }

  async complete(id: string, actor?: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockPurchase(tx, id);
      const purchase = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
      if (!purchase) throw new NotFoundException('Закупка не найдена');
      await this.completePurchase(tx, purchase, actor);
    });
    return this.findOne(id);
  }

  async cancel(id: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockPurchase(tx, id);
      const purchase = await tx.purchase.findUnique({ where: { id } });
      if (!purchase) throw new NotFoundException('Закупка не найдена');
      if (purchase.status === PurchaseStatus.completed) {
        throw new BadRequestException('Проведённую закупку нельзя отменить');
      }
      await tx.purchase.update({ where: { id }, data: { status: PurchaseStatus.cancelled } });
    });
    return this.findOne(id);
  }

  private async lockPurchase(tx: Prisma.TransactionClient, id: string) {
    const cafeId = getCafeId();
    const tenant = cafeId ? Prisma.sql` AND cafe_id = ${cafeId}` : Prisma.empty;
    await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${id}${tenant} FOR UPDATE`;
  }

  private async completePurchase(tx: Prisma.TransactionClient, purchase: Prisma.PurchaseGetPayload<{ include: { items: true } }>, actor?: AuthUser) {
    if (purchase.status === PurchaseStatus.completed) throw new ConflictException('Закупка уже проведена');
    if (purchase.status === PurchaseStatus.cancelled) throw new BadRequestException('Отменённую закупку нельзя провести');
    if (!purchase.items.length) throw new BadRequestException('В закупке нет позиций');
    this.validateDate(purchase.date.toISOString(), true);

    const warehouse = await resolveWarehouse(tx, purchase.warehouseId);
    await lockIngredients(tx, purchase.items.map((item) => item.ingredientId));
    const postedAt = new Date();
    const effectiveAt = purchase.effectiveAt;
    if (effectiveAt && effectiveAt > postedAt) throw new BadRequestException('Дата складской операции не может быть в будущем');
    const insertedMovementIds: string[] = [];
    let stockPostedAt = effectiveAt ? postedAt : null;
    let total = new Prisma.Decimal(0);
    for (const item of purchase.items) {
      const ingredient = await tx.ingredient.findUnique({
        where: { id: item.ingredientId },
        select: { id: true, stock: true, avgCost: true },
      });
      if (!ingredient) throw new NotFoundException('Сырьё закупки не найдено');

      if (item.quantityBase.lte(0)) throw new BadRequestException('Количество должно быть больше нуля');
      total = total.add(item.total);
      const result = await postStockMovement(tx, { ingredientId: item.ingredientId, warehouse,
        change: item.quantityBase, cost: item.total.div(item.quantityBase), costKnown: true, value: item.total, valuation: 'average',
        movement: { type: 'purchase', sourceType: 'purchase', sourceId: purchase.id,
          ...(effectiveAt ? { createdAt: effectiveAt, recordedAt: postedAt } : {}),
          actorId: actor?.id, actorName: actor?.name, comment: `Приход от ${purchase.supplier}` } });
      if (effectiveAt) insertedMovementIds.push(result.movement.id);
      stockPostedAt ??= result.movement.createdAt;
    }

    if (effectiveAt) {
      if (!purchase.cafeId) throw new BadRequestException('Заведение не назначено');
      await replayHistoricalStock(tx, { cafeId: purchase.cafeId, effectiveAt, insertedMovementIds });
      await tx.auditLog.create({ data: { cafeId: purchase.cafeId, userId: actor?.id, userName: actor?.name, userRole: actor?.role,
        actionType: 'PURCHASE_POSTED_RETROSPECTIVELY', entityType: 'PURCHASE', entityId: purchase.id,
        description: 'Поставка проведена с пересчётом себестоимости',
        metadata: { effectiveAt: effectiveAt.toISOString(), postedAt: postedAt.toISOString(), movementIds: insertedMovementIds } } });
    }
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: PurchaseStatus.completed, totalAmount: total, warehouseId: warehouse?.id ?? null, stockPostedAt },
    });
  }

  private itemCreateData(i: NormalizedItem) {
    return {
      ingredientId: i.ingredientId,
      packageId: i.packageId, packageName: i.packageName, packageUnit: i.packageUnit, packageQuantity: i.packageQuantity, packageFactor: i.packageFactor,
      unit: i.unit,
      quantity: new Prisma.Decimal(i.quantity),
      purchasePrice: new Prisma.Decimal(i.purchasePrice),
      total: new Prisma.Decimal(i.total), grossTotal: i.grossTotal,
      quantityBase: new Prisma.Decimal(i.quantityBase),
      unitPriceBase: new Prisma.Decimal(i.unitPriceBase),
    };
  }

  /**
   * Нормализует позиции: проверяет единицу (совместимость с типом ингредиента) и
   * считает базовые значения. quantity/purchasePrice остаются в выбранной единице
   * (для документа), а в расчёт остатка/себестоимости идут quantityBase/total.
   */
  private async normalizeItems(
    items: PurchaseItemInputDto[], db: Prisma.TransactionClient = this.prisma,
    savedItems: Prisma.PurchaseItemGetPayload<{}>[] = [],
  ): Promise<NormalizedItem[]> {
    if (!items || items.length === 0) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
    }
    const savedById = new Map(savedItems.map((item) => [item.id, item]));
    const usedSnapshots = new Set<string>();
    for (const item of items) {
      if (!item.purchaseItemId) continue;
      const saved = savedById.get(item.purchaseItemId);
      if (!saved || !item.packageId || saved.ingredientId !== item.ingredientId || saved.packageId !== item.packageId) {
        throw new BadRequestException('Сохранённая строка фасовки не относится к этой позиции прихода');
      }
      if (usedSnapshots.has(saved.id)) throw new BadRequestException('Сохранённая строка фасовки указана несколько раз');
      usedSnapshots.add(saved.id);
    }
    const ids = [...new Set(items.map((i) => i.ingredientId).filter(Boolean))];
    const ingredients = await db.ingredient.findMany({
      where: { id: { in: ids } },
      select: { id: true, unitType: true, displayUnit: true, purchaseUnit: true, purchaseFactor: true, purchaseUnits: true, preparationMode: true },
    });
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const packageIds = [...new Set(items.flatMap((item) => item.packageId ? [item.packageId] : []))];
    const packages = packageIds.length ? await db.warehousePackage.findMany({ where: { id: { in: packageIds }, isActive: true } }) : [];
    const byPackage = new Map(packages.map((item) => [item.id, item]));

    return items.map((i) => {
      if (!i.ingredientId) throw new BadRequestException('Выберите сырьё в каждой позиции');
      const ingredient = byId.get(i.ingredientId);
      if (!ingredient) throw new BadRequestException('Сырьё позиции не найдено');

      if (ingredient.preparationMode === 'virtual') throw new BadRequestException('Заготовка без остатка не может поступать на склад');
      if (!Number.isFinite(i.quantity) || i.quantity <= 0) throw new BadRequestException('Количество должно быть больше 0');
      const quantity = new Prisma.Decimal(i.quantity).toDecimalPlaces(3);
      const snapshot = i.purchaseItemId ? savedById.get(i.purchaseItemId)! : undefined;
      const pack = i.packageId ? byPackage.get(i.packageId) : undefined;
      if (i.packageId && !pack && !snapshot) throw new BadRequestException('Фасовка не найдена или находится в архиве');
      if (!snapshot && pack && pack.unitType !== ingredient.unitType) throw new BadRequestException('Фасовка несовместима с единицей товара');
      if (snapshot?.packageUnit) assertUnitMatchesType(normalizeUnit(snapshot.packageUnit), ingredient.unitType);
      const customUnit = i.unit ? purchaseUnitsFor(ingredient).find((entry) => entry.name.toLocaleLowerCase() === i.unit!.trim().toLocaleLowerCase()) : undefined;
      const unit = snapshot ? snapshot.unit : pack ? pack.name : customUnit ? customUnit.name : i.unit ? normalizeUnit(i.unit) : normalizeUnit(ingredient.displayUnit);
      if (!snapshot && !pack && !customUnit) assertUnitMatchesType(unit as UnitCode, ingredient.unitType);
      const factor = snapshot ? snapshot.packageFactor ?? snapshot.quantityBase.div(snapshot.quantity)
        : pack ? pack.quantityBase : customUnit ? new Prisma.Decimal(customUnit.factor).mul(toBase(1, normalizeUnit(ingredient.displayUnit))) : new Prisma.Decimal(toBase(1, unit as UnitCode));
      let total: Prisma.Decimal;
      if (i.total != null) {
        if (!Number.isFinite(i.total) || i.total < 0) throw new BadRequestException('Укажите корректную сумму позиции');
        total = new Prisma.Decimal(i.total).toDecimalPlaces(2);
      } else {
        if (i.purchasePrice == null || !Number.isFinite(i.purchasePrice) || i.purchasePrice < 0) throw new BadRequestException('Укажите цену за единицу или сумму позиции');
        total = quantity.mul(i.purchasePrice).toDecimalPlaces(2);
      }
      const quantityBase = quantity.mul(factor).toDecimalPlaces(3);
      if (quantityBase.lte(0) || quantityBase.gte('100000000000')) throw new BadRequestException('Количество вне допустимого диапазона');
      return { ingredientId: i.ingredientId, unit, quantity, total, grossTotal: total, quantityBase,
        ...(snapshot ? { packageId: snapshot.packageId!, packageName: snapshot.packageName ?? snapshot.unit,
          packageUnit: snapshot.packageUnit ?? undefined, packageQuantity: snapshot.packageQuantity ?? undefined, packageFactor: factor }
          : pack ? { packageId: pack.id, packageName: pack.name, packageUnit: pack.unit, packageQuantity: pack.quantity, packageFactor: factor }
          : customUnit ? { packageName: customUnit.name, packageUnit: ingredient.displayUnit, packageQuantity: new Prisma.Decimal(customUnit.factor), packageFactor: factor } : {}),
        purchasePrice: total.div(quantity).toDecimalPlaces(8), unitPriceBase: total.div(quantityBase).toDecimalPlaces(8) };
    });
  }

  private discountItems(items: NormalizedItem[], discount: Prisma.Decimal) {
    const gross = items.reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0));
    if (discount.lt(0) || discount.gt(gross)) throw new BadRequestException('Скидка не может превышать сумму прихода');
    let cumulativeGross = new Prisma.Decimal(0);
    let allocated = new Prisma.Decimal(0);
    return items.map((item) => {
      cumulativeGross = cumulativeGross.add(item.total);
      const target = gross.isZero() ? new Prisma.Decimal(0) : cumulativeGross.mul(discount).div(gross).toDecimalPlaces(2);
      const share = target.sub(allocated);
      allocated = target;
      const total = item.total.sub(share);
      return { ...item, total, unitPriceBase: total.div(item.quantityBase).toDecimalPlaces(8) };
    });
  }

  private unitLabel(unit: string) {
    try { return unitLabel(normalizeUnit(unit)); } catch { return unit; }
  }

  private validateDate(date?: string, completed = false) {
    if (date !== undefined && !Number.isFinite(new Date(date).getTime())) throw new BadRequestException('Укажите корректную дату');
    if (completed && date !== undefined && new Date(date).getTime() > Date.now()) throw new BadRequestException('Дата и время поставки не могут быть в будущем');
  }

  private validateAttachments(attachments?: string[]) {
    for (const url of attachments ?? []) {
      try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error(); }
      catch { throw new BadRequestException('Вложение должно быть ссылкой HTTP или HTTPS'); }
    }
  }

  private dateRange(from?: string, to?: string): Prisma.PurchaseWhereInput | undefined {
    const date = purchaseDateRange(from, to);
    return date ? { OR: [
      { effectiveAt: date },
      { effectiveAt: null, stockPostedAt: date },
      { effectiveAt: null, stockPostedAt: null, date },
    ] } : undefined;
  }
}
