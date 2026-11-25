import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Ingredient, IngredientKind, IngredientUnitType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIngredientDto, UpdateIngredientDto } from './dto';
import { syncIngredientPackages } from './packages';
import { importCatalogue, type IngredientImportDto } from './ingredient-import';
import { listIngredientCategories, lockIngredientCategories, registerIngredientCategories, removeIngredientCategory, saveIngredientCategory } from './ingredient-categories';
import { archivePreparation, lockRecipeGraph, RecipeResolver, type ResolvedRecipePart } from './recipe-resolution';
import { RecipeCalculator, type RecipeCostRow } from './recipe-calculation';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveWarehouseSupplier } from './suppliers';
import { purchaseUnitsFor, validatePurchaseUnits } from './purchase-units';
import { postStockMovement } from './stock-posting';
import { PurchasesService } from './purchases.service';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import {
  getWarehouseBalance, resolveWarehouse, resolveWarehouseSelection, selectedWarehouseDocumentFilter,
  selectedWarehousePurchaseSql, setWarehouseBalance, warehouseBalances, type WarehouseLocation,
} from './warehouse-location';
import { getCafeId } from '../tenant/tenant-context';
import { balanceExportColumns, filteredBalances, writeBalanceWorkbook, type BalanceExportQuery, type BalanceListQuery } from './balance-xlsx';
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
  constructor(private prisma: PrismaService, private purchases: PurchasesService = new PurchasesService(prisma)) {}

  importCatalogue(dto: IngredientImportDto) {
    return this.prisma.$transaction((db) => importCatalogue(db, dto));
  }

  categories() {
    return listIngredientCategories(this.prisma);
  }

  saveCategory(name: string, from?: string) {
    return this.prisma.$transaction((tx) => saveIngredientCategory(tx, name, from));
  }

  removeCategory(name: string) {
    return this.prisma.$transaction((tx) => removeIngredientCategory(tx, name));
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
      processingLosses: i.unitType === 'mass' ? i.processingLosses : null,
      pieceWeightGrams: i.pieceWeightGrams == null ? null : Number(i.pieceWeightGrams),
      roundPieceWriteoff: i.roundPieceWriteoff,
      unitType: i.unitType,
      baseUnit: baseUnitForType(i.unitType as 'mass' | 'volume' | 'count'),
      displayUnit: display,
      unit: unitLabel(display), // кириллица для UI
      // Значения в display-единице — то, что видит и вводит админ.
      stock: round3(fromBase(stockBase, display)),
      avgCost: i.valuationKnown ? round2(costFromBase(avgCostBase, display)) : null,
      stockValue: i.stock.isZero() ? 0 : i.valuationKnown ? Number(i.stock.mul(i.avgCost).toDecimalPlaces(2)) : null,
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

  async findAll(params: { search?: string; includeInactive?: boolean; warehouseId?: string; warehouseIds?: string;
    lastPurchasePrice?: boolean; retailValue?: boolean }) {
    return this.prisma.$transaction(async (db) => {
      const where: Prisma.IngredientWhereInput = {
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(params.search ? { OR: ['name', 'category'].map((field) => ({ [field]: { contains: params.search, mode: 'insensitive' as const } })) } : {}),
      };
      const warehouses = await resolveWarehouseSelection(db, params);
      const warehouse = warehouses.length === 1 ? warehouses[0] : null;
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
          const parts: ResolvedRecipePart[] = [];
          for (const row of recipe.items) parts.push(...await resolver.expand(row.ingredientId, row.amount, warehouse, { path: [item.id] }));
          expanded.set(item.id, parts);
          for (const part of parts) costingItems.set(part.ingredient.id, part.ingredient);
        } catch (error) {
          // Old empty/incomplete recipes must remain visible and editable.
          if (!(error instanceof BadRequestException)) throw error;
          expanded.set(item.id, null);
        }
      }
      const ids = items.map(({ id }) => id);
      const [balances, receiptPrices, retailPrices] = await Promise.all([
        warehouseBalances(db, warehouses, [...costingItems.values()]),
        params.lastPurchasePrice ? this.lastPurchasePrices(db, ids, warehouses) : undefined,
        params.retailValue ? this.retailPrices(db, ids) : undefined,
      ]);
      return items.map((item) => {
        const parts = expanded.get(item.id);
        const recipe = recipesById.get(item.id);
        let recipeUnitCost: number | null = null;
        let recipeTotalCost: number | null = null;
        let knownRecipeTotalCost = 0;
        if (recipe && parts?.length) {
          const cost = parts.reduce((sum, part) => {
            const balance = balances.get(part.ingredient.id);
            return balance?.valuationKnown ? sum.add(part.amount.mul(balance.avgCost)) : sum;
          }, new Prisma.Decimal(0));
          knownRecipeTotalCost = Number(cost.toDecimalPlaces(2));
          if (parts.every((part) => balances.get(part.ingredient.id)?.valuationKnown)) {
            recipeUnitCost = Number(cost.mul(toBase(1, normalizeUnit(item.displayUnit))).div(recipe.outputAmount).toDecimalPlaces(8));
            recipeTotalCost = knownRecipeTotalCost;
          }
        }
        const balance = balances.get(item.id)!;
        const receiptPrice = receiptPrices?.get(item.id);
        const retailPrice = retailPrices?.get(item.id);
        const knownStockValue = balance.knownStockValue.toNumber();
        return { ...this.serialize({ ...item, ...balance }), recipeUnitCost, recipeTotalCost, knownRecipeTotalCost,
          stockValue: balance.stockValueKnown ? knownStockValue : null, knownStockValue,
          lastPurchasePrice: receiptPrice == null ? null : Number(receiptPrice.mul(toBase(1, normalizeUnit(item.displayUnit))).toDecimalPlaces(8)),
          retailValue: retailPrice == null || (item.isPrepared && item.preparationMode === 'virtual')
            ? null : Number(retailPrice.mul(balance.stock).toDecimalPlaces(2)),
          recipeOutputQuantity: recipe ? fromBase(Number(recipe.outputAmount), normalizeUnit(recipe.outputUnit)) : null, recipeOutputUnit: recipe?.outputUnit ?? null };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async balances(query: BalanceListQuery) {
    const items = await this.balanceItems(query);
    const rows = filteredBalances(items, query);
    const valued = rows.filter((item) => !item.isPrepared || item.preparationMode !== 'virtual');
    const pageSize = query.pageSize ?? 50;
    const page = Math.min(query.page ?? 1, Math.max(1, Math.ceil(rows.length / pageSize)));
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalRows: rows.length,
      categories: [...new Set(items.flatMap(({ category }) => category ? [category] : []))].sort((a, b) => a.localeCompare(b, 'ru')),
      stockValue: valued.reduce((sum, item) => sum.add(item.knownStockValue), new Prisma.Decimal(0)).toNumber(),
      incompleteStockValue: valued.some((item) => item.stockValue == null) };
  }

  async exportXlsx(query: BalanceExportQuery) {
    const columns = balanceExportColumns(query.columns);
    const [items, warehouses] = await Promise.all([
      this.balanceItems(query), resolveWarehouseSelection(this.prisma, query),
    ]);
    return writeBalanceWorkbook(filteredBalances(items, query), warehouses.map(({ name }) => name).join(', ') || 'Все склады', columns);
  }

  private balanceItems(query: BalanceExportQuery) {
    const columns = balanceExportColumns(query.columns);
    return this.findAll({ warehouseId: query.warehouseId, warehouseIds: query.warehouseIds,
      lastPurchasePrice: columns.includes('lastPurchasePrice'), retailValue: columns.includes('retailValue') });
  }

  private async lastPurchasePrices(db: Prisma.TransactionClient, ids: string[], warehouses: WarehouseLocation[]) {
    if (!ids.length) return new Map<string, Prisma.Decimal | null>();
    const cafeId = getCafeId();
    const warehouseSql = selectedWarehousePurchaseSql(warehouses);
    const prices = await db.$queryRaw<{ ingredientId: string; unitPriceBase: Prisma.Decimal | null }[]>`
      SELECT DISTINCT ON (pi.ingredient_id) pi.ingredient_id AS "ingredientId",
        SUM(pi.total) / NULLIF(SUM(pi.quantity_base), 0) AS "unitPriceBase"
      FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
      WHERE pi.ingredient_id IN (${Prisma.join(ids)}) AND pi.cafe_id IS NOT DISTINCT FROM ${cafeId}
        AND p.cafe_id IS NOT DISTINCT FROM ${cafeId} AND p.status = 'completed' ${warehouseSql}
      GROUP BY pi.ingredient_id, p.id
      ORDER BY pi.ingredient_id, COALESCE(p.effective_at, p.stock_posted_at, p.date) DESC, p.created_at DESC, p.id DESC
    `;
    return new Map(prices.map(({ ingredientId, unitPriceBase }) => [ingredientId, unitPriceBase]));
  }

  private async retailPrices(db: Prisma.TransactionClient, ids: string[]) {
    const wanted = new Set(ids);
    const prices = new Map<string, Prisma.Decimal | null>();
    if (!ids.length) return prices;
    const dishes = await db.dish.findMany({
      where: { isActive: true, isSet: false, OR: [{ stockIngredientId: { in: ids } }, { variants: { some: { stockIngredientId: { in: ids } } } }] },
      select: { stockIngredientId: true, stockAmount: true, price: true,
        variants: { select: { stockIngredientId: true, stockAmount: true, price: true } } },
    });
    for (const dish of dishes) {
      const offers = dish.variants.length ? dish.variants : [dish];
      for (const offer of offers) {
        const binding = offer.stockIngredientId ? offer : dish;
        const id = binding.stockIngredientId;
        if (!id || !wanted.has(id)) continue;
        const amount = binding.stockAmount;
        if (amount.lte(0)) continue;
        const price = offer.price.div(amount);
        // A single retail value is only meaningful if every active offer has the same per-unit price.
        const previous = prices.get(id);
        prices.set(id, previous === undefined || previous?.eq(price) ? price : null);
      }
    }
    return prices;
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
      const cafeId = ingredient.cafeId;
      const dishFields = { id: true, name: true, catalogKind: true, isActive: true, isSet: true, prepStation: true,
        category: { select: { prepStation: true } } } as const;
      const [recipes, direct, variants, preparations, modifiers, latest, aggregateBalances] = await Promise.all([
        db.recipeItem.findMany({ where: { ingredientId: id, cafeId, dish: { cafeId } },
          include: { dish: { select: dishFields }, variant: { select: { id: true, name: true } } } }),
        db.dish.findMany({ where: { stockIngredientId: id, cafeId }, select: { ...dishFields, stockAmount: true } }),
        db.dishVariant.findMany({ where: { stockIngredientId: id, cafeId, dish: { cafeId } }, select: { id: true, name: true,
          stockAmount: true, dish: { select: dishFields } } }),
        cafeId ? db.preparationRecipeItem.findMany({ where: { ingredientId: id, cafeId, recipe: { cafeId, ingredient: { cafeId } } },
          include: { recipe: { select: { ingredient: { select: { id: true, name: true, isActive: true } } } } } }) : Promise.resolve([]),
        db.menuModifierOption.findMany({ where: { ingredientId: id, cafeId, group: { cafeId, dish: { cafeId } } }, select: { id: true,
          name: true, isActive: true, amount: true, amountUnit: true, group: { select: { name: true, dish: { select: dishFields } } } } }),
        db.$queryRaw<Array<{ unitPriceBase: Prisma.Decimal | null }>>`
          SELECT SUM(pi.total) / NULLIF(SUM(pi.quantity_base), 0) AS "unitPriceBase"
          FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
          WHERE pi.ingredient_id = ${id} AND pi.cafe_id IS NOT DISTINCT FROM ${ingredient.cafeId}
            AND p.cafe_id IS NOT DISTINCT FROM ${ingredient.cafeId} AND p.status = 'completed'
          GROUP BY p.id
          ORDER BY COALESCE(p.effective_at, p.stock_posted_at, p.date) DESC, p.created_at DESC, p.id DESC
          LIMIT 1
        `,
        warehouseBalances(db, null, [ingredient]),
      ]);
      const displayQuantity = (amount: Prisma.Decimal, storedUnit: string) => {
        const displayUnit = normalizeUnit(storedUnit);
        return { quantity: fromBase(Number(amount), displayUnit), unit: unitLabel(displayUnit) };
      };
      const menuUsage = (sourceId: string, dish: Pick<typeof direct[number], keyof typeof dishFields>,
        kind: 'recipe' | 'stock' | 'variant' | 'modifier', amount: Prisma.Decimal, unit: string,
        label: string | null = null, active = dish.isActive) => ({
        sourceId, targetId: dish.id, name: dish.name, kind, label, active, catalogKind: dish.catalogKind, isSet: dish.isSet,
        ...displayQuantity(amount, unit),
      });
      const calculator = await RecipeCalculator.create(db);
      const amounts = async (row: RecipeCostRow, station: string, variantId?: string) => {
        const { items: [item] } = await calculator.composition([row], station, variantId);
        const net = item.netAmount ?? item.amount * (1 - item.lossPercent / 100);
        return { quantity: item.amount, unit: item.unit, netQuantity: item.netWeightGrams ?? net,
          netUnit: item.netWeightGrams == null ? item.unit : 'г', lineCost: item.lineCost };
      };
      const usage = [
        ...await Promise.all(recipes.map(async (row) => ({
          ...menuUsage(row.id, row.dish, 'recipe', row.amount, row.amountUnit, row.variant?.name),
          ...await amounts({ ...row, ingredient }, row.dish.prepStation ?? row.dish.category.prepStation, row.variant?.id),
          ...(row.variant && { variantId: row.variant.id }),
        }))),
        ...direct.map((dish) => menuUsage(dish.id, dish, 'stock', dish.stockAmount, unit)),
        ...variants.map((variant) => ({
          ...menuUsage(variant.id, variant.dish, 'variant', variant.stockAmount, unit, variant.name),
          variantId: variant.id,
        })),
        ...await Promise.all(preparations.map(async (row) => {
          const product = row.recipe.ingredient;
          return { sourceId: product.id, targetId: product.id, name: product.name, kind: 'preparation' as const, label: null,
            active: product.isActive, catalogKind: null, isSet: false,
            ...await amounts({ ...row, ingredient, amountUnit: row.unit, warehouseId: null, fromCommonWarehouse: true, variantAmounts: null }, '') };
        })),
        ...modifiers.map((option) => menuUsage(option.id, option.group.dish, 'modifier', option.amount, option.amountUnit,
          `${option.group.name} · ${option.name}`, option.group.dish.isActive && option.isActive)),
      ].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.kind.localeCompare(b.kind) || a.sourceId.localeCompare(b.sourceId));
      return { ...this.serialize({ ...ingredient, ...aggregateBalances.get(id)! }), balances, usage,
        usedInDishes: [...new Map(usage.filter(({ kind }) => kind !== 'preparation')
          .map(({ targetId: id, name }) => [id, { id, name }])).values()],
        lastPurchasePrice: latest[0]?.unitPriceBase == null ? null : Number(latest[0].unitPriceBase.mul(toBase(1, unit)).toDecimalPlaces(8)) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async supplies(id: string, params: { warehouseId?: string; warehouseIds?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    return this.prisma.$transaction(async (db) => {
      const ingredient = await this.ensure(id, db);
      const warehouses = await resolveWarehouseSelection(db, params);
      const defaultWarehouse = await db.warehouse.findFirst({ where: { isDefault: true } });
      const cafeId = getCafeId();
      const where: Prisma.PurchaseWhereInput = {
        cafeId,
        status: 'completed',
        ...selectedWarehouseDocumentFilter(warehouses),
        items: { some: { ingredientId: id, cafeId } },
      };
      const warehouseSql = selectedWarehousePurchaseSql(warehouses);
      const [total, pageIds] = await Promise.all([
        db.purchase.count({ where }),
        db.$queryRaw<Array<{ id: string }>>`
          SELECT p.id FROM purchases p
          WHERE p.cafe_id = ${cafeId} AND p.status = 'completed' ${warehouseSql}
            AND EXISTS (SELECT 1 FROM purchase_items pi
              WHERE pi.purchase_id = p.id AND pi.ingredient_id = ${id} AND pi.cafe_id = ${cafeId})
          ORDER BY COALESCE(p.effective_at, p.stock_posted_at, p.date) DESC, p.number DESC, p.id DESC
          OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
        `,
      ]);
      const purchases = await db.purchase.findMany({
        where: { ...where, id: { in: pageIds.map((entry) => entry.id) } },
        select: {
          id: true, number: true, date: true, effectiveAt: true, stockPostedAt: true, supplier: true,
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
          purchaseId: purchase.id, number: purchase.number, date: purchase.effectiveAt ?? purchase.stockPostedAt ?? purchase.date,
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

  async create(dto: CreateIngredientDto, actor?: Pick<AuthUser, 'id' | 'name' | 'role'>) {
    if (!dto.name?.trim()) throw new BadRequestException('Укажите название товара');
    const opening = dto.initialSupply;
    if (opening && (dto.stock !== undefined || dto.avgCost !== undefined || dto.warehouseId !== undefined)) {
      throw new BadRequestException('Укажите данные начальной поставки одним способом');
    }
    const unit = normalizeUnit(dto.unit);
    const type = unitTypeOf(unit);
    const balance = {
      stock: new Prisma.Decimal(toBase(dto.stock ?? 0, unit)).toDecimalPlaces(3),
      avgCost: new Prisma.Decimal(costToBase(dto.avgCost ?? 0, unit)).toDecimalPlaces(8),
      valuationKnown: (dto.stock ?? 0) > 0 && (dto.avgCost ?? 0) > 0,
    };
    return this.prisma.$transaction(async (tx) => {
      await lockIngredientCategories(tx);
      await lockWarehouseCatalog(tx);
      const warehouse = await resolveWarehouse(tx, opening?.warehouseId ?? dto.warehouseId);
      const requestKey = opening ? `ingredient-opening:${opening.requestKey}` : undefined;
      const cafeId = getCafeId();
      const previous = requestKey && cafeId ? await tx.purchase.findUnique({
        where: { cafeId_requestKey: { cafeId, requestKey } },
        include: { items: { include: { ingredient: true } } },
      }) : null;
      const previousIngredient = previous?.items[0]?.ingredient;
      if (previous && (!previousIngredient || previous.items.length !== 1 || previousIngredient.name !== dto.name.trim()
          || previousIngredient.displayUnit !== unit || previousIngredient.category !== (dto.category?.trim() || null))) {
        throw new ConflictException('Начальная поставка уже создана для другого ингредиента');
      }
      if (previousIngredient && opening) {
        await this.purchases.createInTransaction(tx, { requestKey, complete: true, warehouseId: opening.warehouseId,
          supplier: dto.supplier?.trim() || undefined, supplierId: dto.supplierId,
          items: [{ ingredientId: previousIngredient.id, unit, quantity: opening.quantity, purchasePrice: opening.unitPrice }],
        }, actor);
        return this.serialize({ ...previousIngredient, ...await getWarehouseBalance(tx, warehouse, previousIngredient) });
      }
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
      if (created.kind === 'raw' || created.kind === 'consumable') await registerIngredientCategories(tx, [created.category]);
      await syncIngredientPackages(tx, created);
      if (opening) {
        await this.purchases.createInTransaction(tx, { requestKey, complete: true, warehouseId: opening.warehouseId,
          supplier: supplier.supplier ?? undefined, supplierId: supplier.supplierId, note: 'Начальный остаток',
          items: [{ ingredientId: created.id, unit, quantity: opening.quantity, purchasePrice: opening.unitPrice }],
        }, actor);
        const received = await this.ensure(created.id, tx);
        return this.serialize({ ...received, ...await getWarehouseBalance(tx, warehouse, received) });
      }
      if (!balance.stock.isZero() || !balance.avgCost.isZero()) {
        await postStockMovement(tx, { ingredientId: created.id, warehouse, change: balance.stock, cost: balance.avgCost, costKnown: (dto.avgCost ?? 0) > 0,
          valuation: 'average', movement: { type: 'correction', sourceType: 'manual', sourceId: created.id, actorId: actor?.id, actorName: actor?.name, comment: 'Начальный остаток' } });
        if (balance.stock.isZero()) await setWarehouseBalance(tx, warehouse, created.id, balance);
      }
      return this.serialize({ ...created, ...balance });
    }, { timeout: 30_000 });
  }

  async update(id: string, dto: UpdateIngredientDto) {
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    return this.prisma.$transaction(async (tx) => {
      const categoryChanged = dto.category !== undefined || dto.kind !== undefined;
      if (categoryChanged) await lockIngredientCategories(tx);
      if (dto.kind !== undefined || dto.preparationMode !== undefined || dto.roundPieceWriteoff !== undefined) await lockRecipeGraph(tx);
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
      if ((data.isPrepared !== undefined && data.isPrepared !== current.isPrepared) ||
          (data.preparationMode !== undefined && data.preparationMode !== current.preparationMode) ||
          (data.roundPieceWriteoff !== undefined && data.roundPieceWriteoff !== current.roundPieceWriteoff)) await archivePreparation(tx, current);
      const updated = await tx.ingredient.update({ where: { id }, data });
      if (categoryChanged && (updated.kind === 'raw' || updated.kind === 'consumable')) {
        await registerIngredientCategories(tx, [updated.category]);
      }
      await syncIngredientPackages(tx, updated);
      return this.serialize({ ...updated, ...after });
    });
  }

  /**
   * Если сырьё используется в техкартах/закупках — деактивируем (isActive=false),
   * чтобы не сломать историю. Иначе удаляем физически.
   */
  async remove(id: string, fromIngredientCatalogue = false) {
    return this.prisma.$transaction(async (tx) => {
      if (fromIngredientCatalogue) await lockRecipeGraph(tx);
      await lockIngredients(tx, [id]);
      const current = await this.ensure(id, tx);
      if (fromIngredientCatalogue && (current.kind !== 'raw' && current.kind !== 'consumable')) {
        throw new BadRequestException('Эта позиция не относится к ингредиентам');
      }
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
      if (fromIngredientCatalogue && current.isActive) {
        if (balances || !current.stock.isZero()) {
          throw new ConflictException('Сначала приведите остаток ингредиента на всех складах к нулю складским документом');
        }
        const activeReferences = await Promise.all([
          used && tx.recipeItem.count({ where: { ingredientId: id, dish: { isActive: true } } }),
          preparationInputs && tx.preparationRecipeItem.count({ where: { ingredientId: id, recipe: { ingredient: { isActive: true } } } }),
          directDishes && tx.dish.count({ where: { stockIngredientId: id, isActive: true } }),
          directVariants && tx.dishVariant.count({ where: { stockIngredientId: id, dish: { isActive: true } } }),
          modifiers && tx.menuModifierOption.count({ where: { ingredientId: id, isActive: true, group: { dish: { isActive: true } } } }),
        ]);
        if (activeReferences.some(Boolean)) {
          throw new ConflictException('Сначала замените ингредиент в действующих техкартах, полуфабрикатах и модификаторах');
        }
      }
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
    const type = current?.unitType ?? unitTypeOf(normalizeUnit(dto.unit));
    const canRoundPieces = type === 'count' && (kind === 'raw' || kind === 'consumable');
    if (dto.roundPieceWriteoff != null && (typeof dto.roundPieceWriteoff !== 'boolean' || (dto.roundPieceWriteoff && !canRoundPieces))) {
      throw new BadRequestException('Округление списания доступно только для штучных ингредиентов');
    }
    let pieceWeightGrams: Prisma.Decimal | null | undefined;
    if (dto.pieceWeightGrams === null) pieceWeightGrams = null;
    else if (dto.pieceWeightGrams !== undefined) {
      if (type !== 'count') throw new BadRequestException('Вес штуки задаётся только для штучных ингредиентов');
      if (!Number.isFinite(dto.pieceWeightGrams) || dto.pieceWeightGrams <= 0) throw new BadRequestException('Укажите вес штуки больше нуля');
      pieceWeightGrams = new Prisma.Decimal(dto.pieceWeightGrams);
      if (pieceWeightGrams.decimalPlaces() > 3 || pieceWeightGrams.gte('100000000000')) throw new BadRequestException('Недопустимый вес штуки');
    }
    let processingLosses: typeof dto.processingLosses;
    if (dto.processingLosses !== undefined) {
      if (!dto.processingLosses || Array.isArray(dto.processingLosses) || Object.entries(dto.processingLosses).some(([method, percent]) =>
        !['cleaning', 'boiling', 'frying', 'stewing', 'baking'].includes(method) || typeof percent !== 'number' || !Number.isFinite(percent) || percent < -999.99 || percent >= 100)) {
        throw new BadRequestException('Потери обработки должны быть от −999,99 до 99,99% для выбранного способа');
      }
      if (type === 'mass') processingLosses = dto.processingLosses;
      else {
        const stored = current?.processingLosses as Record<string, unknown> | null | undefined;
        // Old clients can resend stored losses on an unrelated edit without reactivating the setting.
        if (Object.entries(dto.processingLosses).some(([method, percent]) => percent !== 0 && stored?.[method] !== percent)) {
          throw new BadRequestException('Потери обработки настраиваются только для весовых ингредиентов');
        }
      }
    }
    return {
      kind, isPrepared: prepared, preparationMode: mode,
      processingLosses, pieceWeightGrams,
      roundPieceWriteoff: canRoundPieces ? dto.roundPieceWriteoff ?? undefined : false,
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
