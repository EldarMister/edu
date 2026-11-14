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
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients } from './stock-lock';
import { getWarehouseBalance, resolveWarehouse, warehouseDocumentFilter } from './warehouse-location';
import { assertUnitMatchesType, costToBase, normalizeUnit, toBase, unitLabel, type UnitCode } from './units';

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
      supplier: p.supplier, supplierId: p.supplierId,
      warehouseId: p.warehouseId,
      totalAmount: Number(p.totalAmount), note: p.note, attachments: p.attachments ?? [], discount: Number(p.discount ?? 0),
      status: p.status as PurchaseStatus,
      itemsCount: p._count?.items ?? p.items?.length ?? 0,
      items: p.items ? p.items.map((i: any) => this.serializeItem(i)) : undefined,
      createdAt: p.createdAt,
    };
  }

  async findAll(params: { status?: PurchaseStatus; search?: string; from?: string; to?: string; warehouseId?: string }) {
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(this.prisma, params.warehouseId);
    const search = params.search?.trim();
    const numberMatch = search?.match(/^(?:ЗКП-)?(\d+)$/i);
    const number = numberMatch ? Number(numberMatch[1]) : NaN;
    const searchConditions: Prisma.PurchaseWhereInput[] = search ? [
      { supplier: { contains: search, mode: 'insensitive' } },
      { note: { contains: search, mode: 'insensitive' } },
      ...(Number.isInteger(number) && number > 0 && number <= 2147483647 ? [{ number }] : []),
    ] : [];
    const where: Prisma.PurchaseWhereInput = {
      ...warehouseDocumentFilter(warehouse),
      ...(params.status ? { status: params.status } : {}),
      // The default warehouse already has an OR for legacy records without a warehouseId.
      ...(searchConditions.length ? { AND: [{ OR: searchConditions }] } : {}),
      ...(this.dateRange(params.from, params.to)),
    };
    const purchases = await this.prisma.purchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    return purchases.map((p) => this.serialize(p));
  }

  async overview(params: { from?: string; to?: string; warehouseId?: string }) {
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(this.prisma, params.warehouseId);
    const where: Prisma.PurchaseWhereInput = {
      ...warehouseDocumentFilter(warehouse),
      status: PurchaseStatus.completed,
      ...(this.dateRange(params.from, params.to)),
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
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { ingredient: { select: { name: true } } } } },
    });
    if (!purchase) throw new NotFoundException('Закупка не найдена');
    return this.serialize(purchase);
  }

  async create(dto: CreatePurchaseDto, actor?: AuthUser) {
    const discount = new Prisma.Decimal(dto.discount ?? 0).toDecimalPlaces(2);
    this.validateDate(dto.date);
    this.validateAttachments(dto.attachments);
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
          supplier: supplier.supplier!, supplierId: supplier.supplierId, requestKey: dto.requestKey, note: dto.note?.trim() || null, attachments: dto.attachments ?? [], discount,
          warehouseId: warehouse?.id ?? null,
          totalAmount: new Prisma.Decimal(total),
          items: { create: items.map((item) => this.itemCreateData(item)) },
        },
        include: { items: true },
      });
      if (dto.complete) await this.completePurchase(tx, purchase, actor);
      return purchase.id;
    });
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
    const rawItems = dto.items ? await this.normalizeItems(dto.items) : undefined;
    this.validateDate(dto.date);
    this.validateAttachments(dto.attachments);
    const warehouse = dto.warehouseId === undefined ? undefined : await resolveWarehouse(this.prisma, dto.warehouseId);

    await this.prisma.$transaction(async (tx) => {
      await this.lockPurchase(tx, id);
      const purchase = await tx.purchase.findUnique({ where: { id } });
      if (!purchase) throw new NotFoundException('Закупка не найдена');
      if (purchase.status === PurchaseStatus.cancelled) throw new BadRequestException('Отменённую закупку нельзя редактировать');
      if (purchase.status === PurchaseStatus.completed) throw new BadRequestException('Проведённый приход неизменяем. Оформите возврат поставщику и новый приход');
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
          supplier: supplier?.supplier ?? undefined, supplierId: supplier?.supplierId, note: dto.note === undefined ? undefined : dto.note?.trim() || null,
          attachments: dto.attachments, discount,
          warehouseId: warehouse !== undefined ? warehouse?.id ?? null : undefined,
          totalAmount: total !== undefined ? new Prisma.Decimal(total) : undefined,
        },
        include: { items: true },
      });
      if (dto.complete) await this.completePurchase(tx, updated, actor);
    });
    return this.findOne(id);
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

    const warehouse = await resolveWarehouse(tx, purchase.warehouseId);
    await lockIngredients(tx, purchase.items.map((item) => item.ingredientId));
    let total = new Prisma.Decimal(0);
    for (const item of purchase.items) {
      const ingredient = await tx.ingredient.findUnique({
        where: { id: item.ingredientId },
        select: { id: true, stock: true, avgCost: true },
      });
      if (!ingredient) throw new NotFoundException('Сырьё закупки не найдено');

      if (item.quantityBase.lte(0)) throw new BadRequestException('Количество должно быть больше нуля');
      total = total.add(item.total);
      await postStockMovement(tx, { ingredientId: item.ingredientId, warehouse,
        change: item.quantityBase, cost: item.total.div(item.quantityBase), costKnown: true, value: item.total, valuation: 'average',
        movement: { type: 'purchase', sourceType: 'purchase', sourceId: purchase.id,
          actorId: actor?.id, actorName: actor?.name, comment: `Приход от ${purchase.supplier}` } });
    }

    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: PurchaseStatus.completed, totalAmount: total, warehouseId: warehouse?.id ?? null },
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
  private async normalizeItems(items: PurchaseItemInputDto[], db: Prisma.TransactionClient = this.prisma): Promise<NormalizedItem[]> {
    if (!items || items.length === 0) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
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
      const pack = i.packageId ? byPackage.get(i.packageId) : undefined;
      if (i.packageId && !pack) throw new BadRequestException('Фасовка не найдена или находится в архиве');
      if (pack && pack.unitType !== ingredient.unitType) throw new BadRequestException('Фасовка несовместима с единицей товара');
      const customUnit = i.unit ? purchaseUnitsFor(ingredient).find((entry) => entry.name.toLocaleLowerCase() === i.unit!.trim().toLocaleLowerCase()) : undefined;
      const unit = pack ? pack.name : customUnit ? customUnit.name : i.unit ? normalizeUnit(i.unit) : normalizeUnit(ingredient.displayUnit);
      if (!pack && !customUnit) assertUnitMatchesType(unit as UnitCode, ingredient.unitType);
      const factor = pack ? pack.quantityBase : customUnit ? new Prisma.Decimal(customUnit.factor).mul(toBase(1, normalizeUnit(ingredient.displayUnit))) : new Prisma.Decimal(toBase(1, unit as UnitCode));
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
        ...(pack ? { packageId: pack.id, packageName: pack.name, packageUnit: pack.unit, packageQuantity: pack.quantity, packageFactor: factor }
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

  private validateDate(date?: string) {
    if (date !== undefined && !Number.isFinite(new Date(date).getTime())) throw new BadRequestException('Укажите корректную дату');
  }

  private validateAttachments(attachments?: string[]) {
    for (const url of attachments ?? []) {
      try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error(); }
      catch { throw new BadRequestException('Вложение должно быть ссылкой HTTP или HTTPS'); }
    }
  }

  private dateRange(from?: string, to?: string): Prisma.PurchaseWhereInput {
    if (!from && !to) return {};
    const gte = from ? new Date(from) : undefined;
    const lte = to ? new Date(`${to}T23:59:59.999`) : undefined;
    return { date: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } };
  }
}
