import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto, PurchaseItemInputDto, UpdatePurchaseDto } from './dto';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients } from './stock-lock';
import { getWarehouseBalance, resolveWarehouse, setWarehouseBalance, warehouseDocumentFilter } from './warehouse-location';
import { assertUnitMatchesType, costToBase, normalizeUnit, toBase, unitLabel, type UnitCode } from './units';

// Нормализованная позиция закупки: введённые (display) + базовые значения.
type NormalizedItem = {
  ingredientId: string;
  unit: UnitCode;
  quantity: number; // display
  purchasePrice: number; // за display-единицу
  total: number;
  quantityBase: number;
  unitPriceBase: number;
};

@Injectable()
export class PurchasesService {
  constructor(private prisma: PrismaService) {}

  private serializeItem(item: {
    id: string;
    ingredientId: string;
    unit: string;
    quantity: Prisma.Decimal;
    purchasePrice: Prisma.Decimal;
    total: Prisma.Decimal;
    ingredient?: { name: string } | null;
  }) {
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient?.name ?? '',
      unit: unitLabel(item.unit as UnitCode), // кириллица для UI
      unitCode: item.unit as UnitCode, // код единицы — для форм редактирования
      quantity: Number(item.quantity),
      purchasePrice: Number(item.purchasePrice),
      total: Number(item.total),
    };
  }

  private serialize(p: any) {
    return {
      id: p.id,
      number: p.number,
      date: p.date,
      supplier: p.supplier,
      warehouseId: p.warehouseId,
      totalAmount: Number(p.totalAmount),
      status: p.status as PurchaseStatus,
      itemsCount: p._count?.items ?? p.items?.length ?? 0,
      items: p.items ? p.items.map((i: any) => this.serializeItem(i)) : undefined,
      createdAt: p.createdAt,
    };
  }

  async findAll(params: { status?: PurchaseStatus; search?: string; from?: string; to?: string; warehouseId?: string }) {
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(this.prisma, params.warehouseId);
    const where: Prisma.PurchaseWhereInput = {
      ...warehouseDocumentFilter(warehouse),
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? { supplier: { contains: params.search, mode: 'insensitive' } }
        : {}),
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
    const sum = completed.reduce((acc, p) => acc + Number(p.totalAmount), 0);
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

  async create(dto: CreatePurchaseDto) {
    const items = await this.normalizeItems(dto.items);
    const total = items.reduce((acc, item) => acc + item.total, 0);
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    const purchaseId = await this.prisma.$transaction(async (tx) => {
      if (dto.complete) await lockIngredients(tx, items.map((item) => item.ingredientId));
      const purchase = await tx.purchase.create({
        data: {
          date: dto.date ? new Date(dto.date) : new Date(),
          supplier: dto.supplier.trim(),
          warehouseId: warehouse?.id ?? null,
          totalAmount: new Prisma.Decimal(total),
          items: { create: items.map((item) => this.itemCreateData(item)) },
        },
        include: { items: true },
      });
      if (dto.complete) await this.completePurchase(tx, purchase);
      return purchase.id;
    });
    return this.findOne(purchaseId);
  }

  async update(id: string, dto: UpdatePurchaseDto) {
    const items = dto.items ? await this.normalizeItems(dto.items) : undefined;
    const total = items?.reduce((acc, item) => acc + item.total, 0);
    const warehouse = dto.warehouseId === undefined ? undefined : await resolveWarehouse(this.prisma, dto.warehouseId);

    await this.prisma.$transaction(async (tx) => {
      await this.lockPurchase(tx, id);
      const purchase = await tx.purchase.findUnique({ where: { id } });
      if (!purchase) throw new NotFoundException('Закупка не найдена');
      if (purchase.status === PurchaseStatus.cancelled) throw new BadRequestException('Отменённую закупку нельзя редактировать');
      if (purchase.status === PurchaseStatus.completed) {
        const changedWarehouse = warehouse !== undefined && purchase.warehouseId !== (warehouse?.id ?? null)
          && !(purchase.warehouseId === null && warehouse?.isDefault);
        if (dto.items !== undefined || changedWarehouse) {
          throw new BadRequestException('В проведённой закупке можно изменить только поставщика и дату');
        }
      }
      if (items) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        for (const item of items) {
          await tx.purchaseItem.create({ data: { purchaseId: id, ...this.itemCreateData(item) } });
        }
      }
      await tx.purchase.update({
        where: { id },
        data: {
          date: dto.date !== undefined ? new Date(dto.date) : undefined,
          supplier: dto.supplier?.trim(),
          warehouseId: warehouse !== undefined && purchase.status !== PurchaseStatus.completed ? warehouse?.id ?? null : undefined,
          totalAmount: total !== undefined ? new Prisma.Decimal(total) : undefined,
        },
      });
    });
    return this.findOne(id);
  }

  async complete(id: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockPurchase(tx, id);
      const purchase = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
      if (!purchase) throw new NotFoundException('Закупка не найдена');
      await this.completePurchase(tx, purchase);
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

  private async completePurchase(tx: Prisma.TransactionClient, purchase: Prisma.PurchaseGetPayload<{ include: { items: true } }>) {
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

      const before = await getWarehouseBalance(tx, warehouse, ingredient);
      const stock = before.stock.add(item.quantityBase);
      const avgCost = (before.stock.gt(0)
        ? before.stock.mul(before.avgCost).add(item.total).div(stock)
        : item.total.div(item.quantityBase)).toDecimalPlaces(8);
      total = total.add(item.total);
      await setWarehouseBalance(tx, warehouse, item.ingredientId, { stock, avgCost });
      await tx.stockMovement.create({
        data: {
          ingredientId: item.ingredientId,
          warehouseId: warehouse?.id ?? null,
          type: 'purchase',
          sourceType: 'purchase',
          sourceId: purchase.id,
          beforeStock: before.stock,
          change: item.quantityBase,
          afterStock: stock,
          costAtMoment: item.total.div(item.quantityBase),
          comment: `Закупка от ${purchase.supplier}`,
        },
      });
    }

    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: PurchaseStatus.completed, totalAmount: total, warehouseId: warehouse?.id ?? null },
    });
  }

  private itemCreateData(i: NormalizedItem) {
    return {
      ingredientId: i.ingredientId,
      unit: i.unit,
      quantity: new Prisma.Decimal(i.quantity),
      purchasePrice: new Prisma.Decimal(i.purchasePrice),
      total: new Prisma.Decimal(i.total),
      quantityBase: new Prisma.Decimal(i.quantityBase),
      unitPriceBase: new Prisma.Decimal(i.unitPriceBase),
    };
  }

  /**
   * Нормализует позиции: проверяет единицу (совместимость с типом ингредиента) и
   * считает базовые значения. quantity/purchasePrice остаются в выбранной единице
   * (для документа), а в расчёт остатка/себестоимости идут quantityBase/total.
   */
  private async normalizeItems(items: PurchaseItemInputDto[]): Promise<NormalizedItem[]> {
    if (!items || items.length === 0) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
    }
    const ids = [...new Set(items.map((i) => i.ingredientId).filter(Boolean))];
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: ids } },
      select: { id: true, unitType: true, displayUnit: true },
    });
    const byId = new Map(ingredients.map((i) => [i.id, i]));

    return items.map((i) => {
      if (!i.ingredientId) throw new BadRequestException('Выберите сырьё в каждой позиции');
      const ingredient = byId.get(i.ingredientId);
      if (!ingredient) throw new BadRequestException('Сырьё позиции не найдено');

      const quantity = Number(i.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('Количество должно быть больше 0');
      }

      const unit = i.unit ? normalizeUnit(i.unit) : (ingredient.displayUnit as UnitCode);
      assertUnitMatchesType(unit, ingredient.unitType as 'mass' | 'volume' | 'count');

      // Если задана сумма — она авторитетна, цену за единицу выводим из неё.
      const hasTotal = i.total != null && Number.isFinite(Number(i.total)) && Number(i.total) >= 0;
      let total: number;
      let purchasePrice: number;
      if (hasTotal) {
        total = Math.round(Number(i.total) * 100) / 100;
        purchasePrice = quantity > 0 ? total / quantity : 0;
      } else {
        purchasePrice = Number(i.purchasePrice);
        if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
          throw new BadRequestException('Укажите цену за единицу или сумму позиции');
        }
        total = Math.round(quantity * purchasePrice * 100) / 100;
      }

      const quantityBase = Number(new Prisma.Decimal(toBase(quantity, unit)).toDecimalPlaces(3));
      if (quantityBase <= 0) throw new BadRequestException('Количество в базовой единице должно быть не меньше 0,001');

      return {
        ingredientId: i.ingredientId,
        unit,
        quantity,
        purchasePrice: Math.round(purchasePrice * 10000) / 10000,
        total,
        quantityBase,
        unitPriceBase: costToBase(purchasePrice, unit),
      };
    });
  }

  private dateRange(from?: string, to?: string): Prisma.PurchaseWhereInput {
    if (!from && !to) return {};
    const gte = from ? new Date(from) : undefined;
    const lte = to ? new Date(`${to}T23:59:59.999`) : undefined;
    return { date: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } };
  }
}
