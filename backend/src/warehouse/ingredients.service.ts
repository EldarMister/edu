import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Ingredient, IngredientKind, IngredientUnitType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIngredientDto, UpdateIngredientDto } from './dto';
import { syncIngredientPackages } from './packages';
import { lockRecipeGraph, RecipeResolver, type ResolvedRecipePart } from './recipe-resolution';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveWarehouseSupplier } from './suppliers';
import { purchaseUnitsFor, validatePurchaseUnits } from './purchase-units';
import { postStockMovement } from './stock-posting';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import { getWarehouseBalance, resolveWarehouse, setWarehouseBalance, warehouseBalances, warehouseDocumentFilter } from './warehouse-location';
import { getCafeId } from '../tenant/tenant-context';
import { balanceExportColumns, writeBalanceWorkbook, type BalanceExportQuery } from './balance-xlsx';
import {
  assertUnitMatchesType,
  baseUnitForType,
  costFromBase,
  costToBase,
  costUnitLabel,
  fromBase,
  normalizeUnit,
  toBase,
  unitLabel,
  unitType as unitTypeOf,
  type UnitCode,
} from './units';

type IngredientRow = Ingredient & { supplierRecord?: { name: string } | null };

/**
 * Сырьё (ингредиенты). Всё в БД — в базовых единицах (g|ml|pcs); конвертация в
 * display-единицу админа происходит на границе (serialize / парсинг ввода).
 * Низкий остаток: stockBase <= lowStockThresholdBase.
 */
@Injectable()
export class IngredientsService {
  constructor(private prisma: PrismaService) {}

  async renameCategory(from: string, to: string) {
    const name = to.trim();
    if (!from.trim() || !name) throw new BadRequestException('Укажите название категории');
    return this.prisma.$transaction(async (tx) => {
      await lockWarehouseCatalog(tx);
      const scope: Prisma.IngredientWhereInput = { isPrepared: false, kind: { notIn: ['goods', 'beverage'] } };
      if (from !== name && await tx.ingredient.count({ where: { ...scope, category: name } })) {
        throw new BadRequestException('Категория с таким названием уже существует');
      }
      const result = await tx.ingredient.updateMany({ where: { ...scope, category: from }, data: { category: name } });
      if (!result.count) throw new NotFoundException('Категория не найдена');
      return { name, count: result.count };
    });
  }

  private serialize(i: IngredientRow) {
    const display = i.displayUnit as UnitCode;
    const stockBase = Number(i.stock);
    const thresholdBase = Number(i.lowStockThreshold);
    const avgCostBase = Number(i.avgCost);
    return {
      id: i.id,
      name: i.name,
      kind: i.kind, category: i.category, supplier: i.supplierRecord?.name ?? i.supplier, supplierId: i.supplierId,
      purchaseUnits: purchaseUnitsFor(i),
      purchaseUnit: i.purchaseUnit, purchaseFactor: i.purchaseFactor == null ? null : Number(i.purchaseFactor),
      preparationMode: i.preparationMode,
      processingLosses: i.processingLosses,
      unitType: i.unitType,
      baseUnit: baseUnitForType(i.unitType as 'mass' | 'volume' | 'count'),
      displayUnit: display,
      unit: unitLabel(display), // кириллица для UI
      // Значения в display-единице — то, что видит и вводит админ.
      stock: round3(fromBase(stockBase, display)),
      avgCost: i.valuationKnown ? round2(costFromBase(avgCostBase, display)) : null,
      valuationKnown: i.valuationKnown,
      lowStockThreshold: round3(fromBase(thresholdBase, display)),
      costUnitLabel: costUnitLabel(display),
      // Базовые значения — для тех, кому нужна «сырая» цифра.
      stockBase: round3(stockBase),
      avgCostBase: i.valuationKnown ? avgCostBase : null,
      isActive: i.isActive,
      isPrepared: i.isPrepared,
      isLow: stockBase <= thresholdBase,
    };
  }

  async findAll(params: { search?: string; includeInactive?: boolean; warehouseId?: string }) {
    return this.prisma.$transaction(async (db) => {
      const where: Prisma.IngredientWhereInput = {
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(params.search ? { OR: ['name', 'category'].map((field) => ({ [field]: { contains: params.search, mode: 'insensitive' as const } })) } : {}),
      };
      const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(db, params.warehouseId);
      const items = await db.ingredient.findMany({ where, include: { supplierRecord: { select: { name: true } } }, orderBy: { name: 'asc' } });
      // Recipe costing is separate from stock valuation. Expand preparations with the
      // same resolver used for sales, then load all leaf balances in one batch.
      const resolver = new RecipeResolver(db, { allowInactive: true });
      const preparedIds = items.filter((item) => item.isPrepared).map((item) => item.id);
      const recipes = preparedIds.length ? await db.preparationRecipe.findMany({ where: { ingredientId: { in: preparedIds } }, include: { items: true } }) : [];
      const recipesById = new Map(recipes.map((recipe) => [recipe.ingredientId, recipe]));
      const expanded = new Map<string, ResolvedRecipePart[] | null>();
      const costingItems = new Map(items.map((item) => [item.id, item as Ingredient]));
      for (const item of items) if (item.isPrepared) {
        try {
          const recipe = recipesById.get(item.id);
          if (!recipe?.items.length || recipe.outputAmount.lte(0)) { expanded.set(item.id, null); continue; }
          const factor = new Prisma.Decimal(toBase(1, normalizeUnit(item.displayUnit))).div(recipe.outputAmount);
          const parts: ResolvedRecipePart[] = [];
          for (const row of recipe.items) parts.push(...await resolver.expand(row.ingredientId, row.amount.mul(factor), warehouse, [item.id]));
          expanded.set(item.id, parts);
          for (const part of parts) costingItems.set(part.ingredient.id, part.ingredient);
        } catch (error) {
          // Old empty/incomplete recipes must remain visible and editable.
          if (!(error instanceof BadRequestException)) throw error;
          expanded.set(item.id, null);
        }
      }
      const balances = await warehouseBalances(db, warehouse, [...costingItems.values()]);
      return items.map((item) => {
        const parts = expanded.get(item.id);
        const recipe = recipesById.get(item.id);
        let recipeUnitCost: number | null = null;
        let recipeTotalCost: number | null = null;
        if (parts?.length && parts.every((part) => balances.get(part.ingredient.id)?.valuationKnown)) {
          const cost = parts.reduce((sum, part) => sum.add(part.amount.mul(balances.get(part.ingredient.id)!.avgCost)), new Prisma.Decimal(0));
          recipeUnitCost = Number(cost.toDecimalPlaces(8));
          if (recipe) recipeTotalCost = Number(cost.mul(recipe.outputAmount).div(toBase(1, normalizeUnit(item.displayUnit))).toDecimalPlaces(2));
        }
        return { ...this.serialize({ ...item, ...balances.get(item.id)! }), recipeUnitCost, recipeTotalCost,
          recipeOutputQuantity: recipe ? fromBase(Number(recipe.outputAmount), normalizeUnit(recipe.outputUnit)) : null, recipeOutputUnit: recipe?.outputUnit ?? null };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async exportXlsx(query: BalanceExportQuery) {
    const columns = balanceExportColumns(query.columns);
    const items = await this.findAll({ warehouseId: query.warehouseId });
    const warehouse = query.warehouseId ? await resolveWarehouse(this.prisma, query.warehouseId) : null;
    return writeBalanceWorkbook(items, warehouse?.name ?? 'Все склады', query, columns);
  }

  async findOne(id: string) {
    return this.prisma.$transaction(async (db) => {
      const ingredient = await this.ensure(id, db);
      const locations = await db.warehouse.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
      const unit = normalizeUnit(ingredient.displayUnit);
      const balances = await Promise.all(locations.map(async (warehouse) => {
        const balance = await getWarehouseBalance(db, warehouse, ingredient);
        return { warehouseId: warehouse.id, warehouseName: warehouse.name,
          stock: fromBase(Number(balance.stock), unit), avgCost: balance.valuationKnown ? costFromBase(Number(balance.avgCost), unit) : null, valuationKnown: balance.valuationKnown };
      }));
      const [recipes, direct, latest] = await Promise.all([
        db.recipeItem.findMany({ where: { ingredientId: id }, select: { dish: { select: { id: true, name: true } } } }),
        db.dish.findMany({ where: { stockIngredientId: id }, select: { id: true, name: true } }),
        db.$queryRaw<Array<{ unitPriceBase: Prisma.Decimal | null }>>`
          SELECT SUM(pi.total) / NULLIF(SUM(pi.quantity_base), 0) AS "unitPriceBase"
          FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
          WHERE pi.ingredient_id = ${id} AND pi.cafe_id IS NOT DISTINCT FROM ${ingredient.cafeId}
            AND p.cafe_id IS NOT DISTINCT FROM ${ingredient.cafeId} AND p.status = 'completed'
          GROUP BY p.id
          ORDER BY COALESCE(p.effective_at, p.date) DESC, p.created_at DESC, p.id DESC
          LIMIT 1
        `,
      ]);
      const aggregate = (await warehouseBalances(db, null, [ingredient])).get(id)!;
      return { ...this.serialize({ ...ingredient, ...aggregate }), balances,
        usedInDishes: [...new Map([...recipes.map(({ dish }) => dish), ...direct].map((dish) => [dish.id, dish])).values()],
        lastPurchasePrice: latest[0]?.unitPriceBase == null ? null : Number(latest[0].unitPriceBase.mul(toBase(1, unit)).toDecimalPlaces(8)) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async supplies(id: string, params: { warehouseId?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    return this.prisma.$transaction(async (db) => {
      const ingredient = await this.ensure(id, db);
      const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(db, params.warehouseId);
      const defaultWarehouse = await db.warehouse.findFirst({ where: { isDefault: true } });
      const cafeId = getCafeId();
      const where: Prisma.PurchaseWhereInput = {
        cafeId,
        status: 'completed',
        ...warehouseDocumentFilter(warehouse),
        items: { some: { ingredientId: id, cafeId } },
      };
      const warehouseSql = !warehouse ? Prisma.empty : warehouse.isDefault
        ? Prisma.sql`AND (p.warehouse_id = ${warehouse.id} OR p.warehouse_id IS NULL)`
        : Prisma.sql`AND p.warehouse_id = ${warehouse.id}`;
      const [total, pageIds] = await Promise.all([
        db.purchase.count({ where }),
        db.$queryRaw<Array<{ id: string }>>`
          SELECT p.id FROM purchases p
          WHERE p.cafe_id = ${cafeId} AND p.status = 'completed' ${warehouseSql}
            AND EXISTS (SELECT 1 FROM purchase_items pi
              WHERE pi.purchase_id = p.id AND pi.ingredient_id = ${id} AND pi.cafe_id = ${cafeId})
          ORDER BY COALESCE(p.effective_at, p.date) DESC, p.id DESC
          OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
        `,
      ]);
      const purchases = await db.purchase.findMany({
        where: { ...where, id: { in: pageIds.map((entry) => entry.id) } },
        select: {
          id: true, number: true, date: true, effectiveAt: true, supplier: true,
          warehouse: { select: { id: true, name: true } },
          items: {
            where: { ingredientId: id, cafeId },
            select: { quantityBase: true, total: true },
          },
        },
      });
      const unit = normalizeUnit(ingredient.displayUnit);
      const factor = toBase(1, unit);
      const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
      const rows = pageIds.flatMap(({ id: purchaseId }) => {
        const purchase = purchaseById.get(purchaseId);
        if (!purchase) return [];
        const quantityBase = purchase.items.reduce((sum, item) => sum.add(item.quantityBase), new Prisma.Decimal(0));
        const quantity = quantityBase.div(factor);
        // Line totals already contain the allocated purchase discount.
        const value = purchase.items.reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0));
        const location = purchase.warehouse ?? defaultWarehouse;
        return [{
          purchaseId: purchase.id, number: purchase.number, date: purchase.effectiveAt ?? purchase.date,
          warehouseId: location?.id ?? null, warehouseName: location?.name ?? 'Основной склад',
          supplier: purchase.supplier, quantity: Number(quantity),
          unitCode: unit, unit: unitLabel(unit),
          unitPrice: quantity.isZero() ? null : Number(value.div(quantity).toDecimalPlaces(8)),
          total: Number(value),
        }];
      });
      return { rows, total, page, pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async overview(warehouseId?: string) {
    return this.prisma.$transaction(async (db) => {
      const warehouse = warehouseId === undefined ? null : await resolveWarehouse(db, warehouseId);
      const active = await db.ingredient.findMany({
        where: { isActive: true },
        select: { id: true, displayUnit: true, stock: true, avgCost: true, valuationKnown: true, lowStockThreshold: true },
      });
      const balances = await warehouseBalances(db, warehouse, active);
      const totalIngredients = active.length;
      let lowStockCount = 0;
      let costSum = 0;
      for (const i of active) {
        const balance = balances.get(i.id)!;
        if (balance.stock.lte(i.lowStockThreshold)) lowStockCount++;
        // Себестоимость приводим к display-единице, чтобы среднее было в человеко-масштабе.
        costSum += costFromBase(Number(balance.avgCost), i.displayUnit as UnitCode);
      }
      const unknownCostCount = [...balances.values()].filter((balance) => !balance.valuationKnown && !balance.stock.isZero()).length;
      const avgCost = unknownCostCount ? null : totalIngredients > 0 ? round2(costSum / totalIngredients) : 0;
      return { totalIngredients, lowStockCount, avgCost, unknownCostCount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async create(dto: CreateIngredientDto, actor?: Pick<AuthUser, 'id' | 'name'>) {
    if (!dto.name?.trim()) throw new BadRequestException('Укажите название товара');
    const unit = normalizeUnit(dto.unit);
    const type = unitTypeOf(unit);
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    const balance = {
      stock: new Prisma.Decimal(toBase(dto.stock ?? 0, unit)).toDecimalPlaces(3),
      avgCost: new Prisma.Decimal(costToBase(dto.avgCost ?? 0, unit)).toDecimalPlaces(8),
      valuationKnown: (dto.stock ?? 0) > 0 && (dto.avgCost ?? 0) > 0,
    };
    const ingredient = await this.prisma.$transaction(async (tx) => {
      await lockWarehouseCatalog(tx);
      const supplier = await resolveWarehouseSupplier(tx, dto);
      const created = await tx.ingredient.create({
        data: {
          ...this.metadata(dto) as Prisma.IngredientUncheckedCreateInput,
          ...supplier, name: dto.name.trim(),
          unitType: type as IngredientUnitType,
          displayUnit: unit,

          lowStockThreshold: new Prisma.Decimal(toBase(dto.lowStockThreshold ?? 0, unit)),
        },
      });
      await syncIngredientPackages(tx, created);
      if (!balance.stock.isZero() || !balance.avgCost.isZero()) {
        await postStockMovement(tx, { ingredientId: created.id, warehouse, change: balance.stock, cost: balance.avgCost, costKnown: (dto.avgCost ?? 0) > 0,
          valuation: 'average', movement: { type: 'correction', sourceType: 'manual', sourceId: created.id, actorId: actor?.id, actorName: actor?.name, comment: 'Начальный остаток' } });
        if (balance.stock.isZero()) await setWarehouseBalance(tx, warehouse, created.id, balance);
      }
      return created;
    });
    return this.serialize({ ...ingredient, ...balance });
  }

  async update(id: string, dto: UpdateIngredientDto) {
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.kind !== undefined || dto.preparationMode !== undefined) await lockRecipeGraph(tx);
      await lockIngredients(tx, [id]);
      const current = await this.ensure(id, tx);
      if (dto.preparationMode === 'virtual' && current.preparationMode !== 'virtual') {
        if (!current.stock.isZero() || await tx.warehouseStock.count({ where: { ingredientId: id, stock: { not: 0 } } })) {
          throw new BadRequestException('Сначала обнулите остатки заготовки документом инвентаризации');
        }
        if (await tx.dish.count({ where: { stockIngredientId: id } }) || await tx.dishVariant.count({ where: { stockIngredientId: id } })) {
          throw new BadRequestException('Сначала отключите прямую продажу заготовки');
        }
      }
      const unit = dto.unit !== undefined ? normalizeUnit(dto.unit) : current.displayUnit as UnitCode;
      const type = unitTypeOf(unit);
      if (type !== current.unitType) throw new BadRequestException('Нельзя менять массу на объём или штуки у существующего товара');
      const data: Prisma.IngredientUpdateInput = this.metadata(dto, current);
      if (dto.name !== undefined) {
        if (!dto.name.trim()) throw new BadRequestException('Укажите название товара');
        data.name = dto.name.trim();
      }
      if (dto.supplier !== undefined || dto.supplierId !== undefined) Object.assign(data, await resolveWarehouseSupplier(tx, dto));
      if (dto.unit !== undefined) {
        data.displayUnit = unit;
        data.unitType = type as IngredientUnitType;
      }
      if (dto.lowStockThreshold !== undefined)
        data.lowStockThreshold = new Prisma.Decimal(toBase(dto.lowStockThreshold, unit));
      if (dto.isActive !== undefined) data.isActive = dto.isActive;

      const before = await getWarehouseBalance(tx, warehouse, current);
      const after = {
        stock: dto.stock === undefined ? before.stock : new Prisma.Decimal(toBase(dto.stock, unit)).toDecimalPlaces(3),
        avgCost: dto.avgCost === undefined ? before.avgCost : new Prisma.Decimal(costToBase(dto.avgCost, unit)).toDecimalPlaces(8),
        valuationKnown: before.valuationKnown,
      };
      if (!before.stock.eq(after.stock) || !before.avgCost.eq(after.avgCost)) {
        throw new BadRequestException('Остаток и себестоимость изменяются документом прихода или инвентаризации');
      }
      const updated = await tx.ingredient.update({ where: { id }, data });
      await syncIngredientPackages(tx, updated);
      return this.serialize({ ...updated, ...after });
    });
  }

  /**
   * Если сырьё используется в техкартах/закупках — деактивируем (isActive=false),
   * чтобы не сломать историю. Иначе удаляем физически.
   */
  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockIngredients(tx, [id]);
      const current = await this.ensure(id, tx);
      const [used, preparationInputs, purchased, movements, balances, documents, directDishes, directVariants, processing, modifiers] = await Promise.all([
        tx.recipeItem.count({ where: { ingredientId: id } }),
        tx.preparationRecipeItem.count({ where: { ingredientId: id } }),
        tx.purchaseItem.count({ where: { ingredientId: id } }),
        tx.stockMovement.count({ where: { ingredientId: id } }),
        tx.warehouseStock.count({ where: { ingredientId: id, stock: { not: 0 } } }),
        tx.warehouseDocumentItem.count({ where: { ingredientId: id } }),
        tx.dish.count({ where: { stockIngredientId: id } }),
        tx.dishVariant.count({ where: { stockIngredientId: id } }),
        tx.processingLine.count({ where: { ingredientId: id } }),
        tx.menuModifierOption.count({ where: { ingredientId: id } }),
      ]);
      if (used || preparationInputs || purchased || movements || balances || documents || directDishes || directVariants || processing || modifiers || current.isPrepared || !current.stock.isZero()) {
        const ingredient = await tx.ingredient.update({
          where: { id },
          data: { isActive: false },
        });
        return { ok: true, deactivated: true, ingredient: this.serialize(ingredient) };
      }
      await tx.ingredient.delete({ where: { id } });
      return { ok: true, deactivated: false };
    });
  }

  private metadata(dto: CreateIngredientDto | UpdateIngredientDto, current?: Ingredient): Prisma.IngredientUncheckedUpdateInput {
    const kind = dto.kind ?? current?.kind ?? IngredientKind.raw;
    const prepared = kind === 'preparation' || kind === 'prepared_dish';
    const mode = dto.preparationMode ?? current?.preparationMode ?? 'stocked';
    if (mode === 'virtual' && !prepared) throw new BadRequestException('Рецепт без остатка доступен только для заготовок');
    if (mode === 'virtual' && (Number(dto.stock ?? current?.stock ?? 0) !== 0)) throw new BadRequestException('У заготовки без остатка не может быть складского количества');
    let units = dto.purchaseUnits ?? (current ? purchaseUnitsFor(current) : []);
    if (dto.purchaseUnits === undefined && (dto.purchaseUnit !== undefined || dto.purchaseFactor !== undefined)) {
      const name = dto.purchaseUnit === undefined ? current?.purchaseUnit : dto.purchaseUnit?.trim() || null;
      const factor = dto.purchaseFactor === undefined ? current?.purchaseFactor : dto.purchaseFactor;
      if (!!name !== (factor != null)) throw new BadRequestException('Для закупочной упаковки укажите название и коэффициент');
      units = name && factor != null ? [{ name, factor: Number(factor) }, ...units.slice(1)] : [];
    } else if (dto.purchaseUnits === undefined && dto.unit && current) {
      const multiplier = toBase(1, normalizeUnit(current.displayUnit)) / toBase(1, normalizeUnit(dto.unit));
      units = units.map((entry) => ({ ...entry, factor: Number(new Prisma.Decimal(entry.factor).mul(multiplier)) }));
    }
    units = validatePurchaseUnits(units, dto.unit ?? current?.displayUnit ?? 'pcs');
    if (dto.processingLosses !== undefined) {
      if (!dto.processingLosses || Array.isArray(dto.processingLosses) || Object.entries(dto.processingLosses).some(([method, percent]) =>
        !['cleaning', 'boiling', 'frying', 'stewing', 'baking'].includes(method) || typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent >= 100)) {
        throw new BadRequestException('Потери обработки должны быть от 0 до 99,99% для выбранного способа');
      }
    }
    return {
      kind, isPrepared: prepared, preparationMode: mode,
      processingLosses: dto.processingLosses,
      category: dto.category === undefined ? undefined : dto.category?.trim() || null,
      supplier: dto.supplier === undefined ? undefined : dto.supplier?.trim() || null,
      purchaseUnits: units.map(({ name, factor }) => ({ name, factor })), purchaseUnit: units[0]?.name ?? null,
      purchaseFactor: units[0] ? new Prisma.Decimal(units[0].factor) : null,
    };
  }

  private async ensure(id: string, db: Prisma.TransactionClient = this.prisma) {
    const ingredient = await db.ingredient.findUnique({ where: { id }, include: { supplierRecord: { select: { name: true } } } });
    if (!ingredient) throw new NotFoundException('Сырьё не найдено');
    return ingredient;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
