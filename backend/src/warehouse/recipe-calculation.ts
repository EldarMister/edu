import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculateSaleTaxes } from '../settings/order-taxes';
import { getCafeId } from '../tenant/tenant-context';
import { recipeAmount, RecipeResolver } from './recipe-resolution';
import { assertUnitMatchesType, baseUnitForType, costUnitLabel, normalizeUnit, toBase, unitLabel, type UnitCode } from './units';
import { getWarehouseBalance, type WarehouseLocation } from './warehouse-location';

export type RecipeIngredient = Prisma.IngredientGetPayload<{}>;
export type RecipeCostRow = {
  id?: string;
  ingredientId: string;
  ingredient: RecipeIngredient;
  warehouseId: string | null;
  fromCommonWarehouse: boolean;
  amount: Prisma.Decimal;
  netAmount: Prisma.Decimal | null;
  amountUnit: string;
  lossPercent: Prisma.Decimal;
  processingMethod: string | null;
  variantAmounts: Prisma.JsonValue | null;
};

const zero = new Prisma.Decimal(0);
const hundred = new Prisma.Decimal(100);
export const emptyCalculation = () => ({ cost: zero, packaging: zero, missing: new Set<string>(), inactive: new Set<string>() });
type Valuation = ReturnType<typeof emptyCalculation>;
type TaxRate = Parameters<typeof calculateSaleTaxes>[0][number]['rate'];
const money = (value: Prisma.Decimal) => Number(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
const quantity = (value: Prisma.Decimal, unit: UnitCode) => Number(value.div(toBase(1, unit)).toDecimalPlaces(6));

export function recipeMetrics(price: Prisma.Decimal | null, value: Valuation, configured: boolean, tax: TaxRate | null = null) {
  const costKnown = configured && value.missing.size === 0;
  const amount = price != null && tax ? calculateSaleTaxes([{ rate: tax, salesAmount: price }])[0]?.amount ?? zero : zero;
  const netPrice = price?.sub(amount) ?? null;
  const profit = netPrice?.sub(value.cost) ?? null;
  const positivePrice = price?.gt(0);
  return {
    price: price == null ? null : money(price),
    foodCost: costKnown ? money(value.cost) : null,
    ingredientCost: costKnown ? money(value.cost.sub(value.packaging)) : null,
    packagingCost: costKnown ? money(value.packaging) : null,
    taxAmount: price == null ? null : money(amount),
    profit: costKnown && profit != null ? money(profit) : null,
    markupPercent: costKnown && positivePrice && value.cost.gt(0) && profit != null ? money(profit.div(value.cost).mul(100)) : null,
    marginAmount: costKnown && profit != null ? money(profit) : null,
    marginPercent: costKnown && netPrice?.gt(0) && profit != null ? money(profit.div(netPrice).mul(100)) : null,
    foodCostPercent: costKnown && positivePrice ? money(value.cost.div(price!).mul(100)) : null,
    missingCosts: [...value.missing], inactiveIngredients: [...value.inactive], costKnown, accountingConfigured: configured,
  };
}

export function addRecipeValue(target: Valuation, value: Valuation, count = 1) {
  target.cost = target.cost.add(value.cost.mul(count));
  target.packaging = target.packaging.add(value.packaging.mul(count));
  for (const name of value.missing) target.missing.add(name);
  for (const name of value.inactive) target.inactive.add(name);
}

/** Shares the sale resolver, while keeping an incomplete legacy recipe visible for correction. */
export class RecipeCalculator {
  private readonly resolver: RecipeResolver;
  private readonly balances = new Map<string, ReturnType<typeof getWarehouseBalance>>();
  private readonly ingredients = new Map<string, Promise<RecipeIngredient | null>>();

  private constructor(private readonly db: Prisma.TransactionClient, private readonly locations: Map<string, WarehouseLocation>,
    private readonly routes: Map<string, WarehouseLocation>, private readonly defaultName: string, readonly taxesEnabled: boolean) {
    this.resolver = new RecipeResolver(db, { allowInactive: true });
  }

  static async create(db: Prisma.TransactionClient) {
    const cafeId = getCafeId() ?? null;
    const [warehouses, routes, settings] = await Promise.all([
      cafeId ? db.warehouse.findMany({ where: { cafeId } }) : [],
      cafeId ? db.stationWarehouse.findMany({ where: { cafeId }, include: { warehouse: true } }) : [],
      db.settings.findFirst({ where: { cafeId }, select: { taxesEnabled: true } }),
    ]);
    const locations: WarehouseLocation[] = warehouses;
    return new RecipeCalculator(db, new Map(locations.map((row) => [row.id, row])),
      new Map(routes.map((row) => [row.stationId, row.warehouse])), locations.find((row) => row.isDefault)?.name ?? 'Основной склад',
      settings?.taxesEnabled === true);
  }

  stationWarehouseName(station: string) {
    return this.routes.get(station)?.name ?? this.defaultName;
  }

  private balance(ingredient: RecipeIngredient, warehouse: WarehouseLocation | null) {
    const key = JSON.stringify([ingredient.id, warehouse?.isDefault ? null : (warehouse?.id ?? null)]);
    const previous = this.balances.get(key);
    if (previous) return previous;
    const value = getWarehouseBalance(this.db, warehouse, ingredient);
    this.balances.set(key, value);
    return value;
  }

  private async value(ingredient: RecipeIngredient, amount: Prisma.Decimal, warehouse: WarehouseLocation | null) {
    const result = emptyCalculation();
    if (!amount.gt(0)) return result;
    try {
      for (const part of await this.resolver.expand(ingredient.id, amount, warehouse)) {
        const balance = await this.balance(part.ingredient, part.warehouse);
        if (!balance.valuationKnown) result.missing.add(part.ingredient.name);
        if (!part.ingredient.isActive) result.inactive.add(part.ingredient.name);
        const cost = part.amount.mul(balance.avgCost);
        result.cost = result.cost.add(cost);
        if (part.ingredient.kind === 'consumable') result.packaging = result.packaging.add(cost);
      }
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      result.missing.add(ingredient.name);
    }
    return result;
  }

  async composition(rows: readonly RecipeCostRow[], station: string, variantId?: string) {
    const value = emptyCalculation();
    const totalsByUnit = new Map<UnitCode, Prisma.Decimal>();
    let totalGrams = zero;
    let hasWeightedPiece = false;
    let allUsableInGrams = true;
    const items = [];
    for (const row of rows) {
      const ingredient = row.ingredient;
      const warehouse = row.warehouseId ? this.locations.get(row.warehouseId) : row.fromCommonWarehouse ? null : this.routes.get(station) ?? null;
      const baseUnit = baseUnitForType(ingredient.unitType);
      let unit = baseUnit;
      let invalidUnit = false;
      try {
        const savedUnit = normalizeUnit(row.amountUnit);
        assertUnitMatchesType(savedUnit, ingredient.unitType);
        unit = savedUnit;
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        invalidUnit = true;
      }
      let amount = row.amount;
      let invalidVariant = false;
      try { amount = recipeAmount(row, variantId); } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        invalidVariant = true;
      }
      const net = !amount.gt(0) ? zero : row.netAmount != null && row.amount.gt(0)
        ? amount.mul(row.netAmount).div(row.amount).toDecimalPlaces(3)
        : row.netAmount == null && amount.eq(row.amount) ? null : amount.mul(hundred.sub(row.lossPercent)).div(hundred).toDecimalPlaces(3);
      const yieldAmount = net ?? amount.mul(hundred.sub(row.lossPercent)).div(hundred).toDecimalPlaces(3);
      const pieceWeight = ingredient.unitType === 'count' ? ingredient.pieceWeightGrams : null;
      const pieceNetWeight = pieceWeight?.mul(yieldAmount) ?? null;
      if (yieldAmount.gt(0) && ingredient.kind !== 'consumable') {
        totalsByUnit.set(baseUnit, (totalsByUnit.get(baseUnit) ?? zero).add(yieldAmount));
        if (baseUnit === 'g') totalGrams = totalGrams.add(yieldAmount);
        else if (pieceNetWeight != null) {
          totalGrams = totalGrams.add(pieceNetWeight);
          hasWeightedPiece = true;
        } else allUsableInGrams = false;
      }
      const rowValue = invalidVariant || (amount.gt(0) && (invalidUnit || row.warehouseId && !warehouse))
        ? { ...emptyCalculation(), missing: new Set([ingredient.name]) }
        : await this.value(ingredient, amount, warehouse ?? null);
      addRecipeValue(value, rowValue);
      const balance = row.warehouseId && !warehouse ? null : await this.balance(ingredient, warehouse ?? null);
      const costKnown = rowValue.missing.size === 0;
      const unitCost = !costKnown ? null : amount.gt(0) ? rowValue.cost.div(amount) : balance?.valuationKnown ? balance.avgCost : null;
      items.push({ id: row.id, ingredientId: row.ingredientId, fromCommonWarehouse: row.fromCommonWarehouse,
        warehouseId: row.warehouseId, warehouseName: row.warehouseId && !warehouse ? null : warehouse?.name ?? this.defaultName,
        isPrepared: ingredient.isPrepared, preparationMode: ingredient.preparationMode, name: ingredient.name, unit: unitLabel(unit),
        amountUnit: unit, unitType: ingredient.unitType, ingredientDisplayUnit: ingredient.displayUnit, amount: quantity(amount, unit),
        baseAmount: quantity(row.amount, unit), netAmount: net == null ? null : quantity(net, unit), lossPercent: Number(row.lossPercent),
        pieceWeightGrams: pieceWeight == null ? null : Number(pieceWeight), netWeightGrams: pieceNetWeight == null ? null : quantity(pieceNetWeight, 'g'),
        processingMethod: row.processingMethod, variantAmounts: Object.fromEntries(
          Object.entries((row.variantAmounts ?? {}) as Record<string, unknown>).flatMap(([id, amount]) => {
            if (!(typeof amount === 'number' || typeof amount === 'string' && amount.trim()) || !Number.isFinite(Number(amount)) || Number(amount) < 0) return [];
            return [[id, quantity(new Prisma.Decimal(amount), unit)]];
          })),
        costKnown, avgCost: unitCost == null ? null : Number(unitCost.mul(toBase(1, unit)).toDecimalPlaces(8)),
        costUnitLabel: costUnitLabel(unit), lineCost: costKnown ? money(rowValue.cost) : null,
        stock: balance ? quantity(balance.stock, unit) : null, isLow: !!balance && balance.stock.lte(ingredient.lowStockThreshold), isActive: ingredient.isActive });
    }
    const [one] = totalsByUnit;
    const output = hasWeightedPiece && allUsableInGrams ? { amount: quantity(totalGrams, 'g'), unit: 'g' as const }
      : totalsByUnit.size === 1 ? { amount: Number(one[1]), unit: one[0] } : null;
    return { items, value, output };
  }

  async direct(ingredientId: string, amount: Prisma.Decimal, station: string) {
    const warehouse = this.routes.get(station) ?? null;
    let record = this.ingredients.get(ingredientId);
    if (!record) {
      record = this.db.ingredient.findUnique({ where: { id: ingredientId } });
      this.ingredients.set(ingredientId, record);
    }
    const ingredient = await record;
    if (!ingredient) return { value: { ...emptyCalculation(), missing: new Set(['Складская позиция недоступна']) }, stockItem: null };
    const unit = normalizeUnit(ingredient.displayUnit);
    return { value: await this.value(ingredient, amount, warehouse), stockItem: { id: ingredient.id, name: ingredient.name,
      unit, amount: quantity(amount, unit), warehouseName: warehouse?.name ?? this.defaultName, kind: ingredient.kind } };
  }
}

export function recipeOutput(metadata: unknown, fallback: { amount: number; unit: UnitCode } | null,
  rows: readonly Pick<RecipeCostRow, 'variantAmounts'>[] = [], variantId?: string) {
  if (fallback && variantId && rows.some(({ variantAmounts }) => variantAmounts && typeof variantAmounts === 'object'
    && !Array.isArray(variantAmounts) && Object.prototype.hasOwnProperty.call(variantAmounts, variantId))) return fallback;
  if (!metadata || typeof metadata !== 'object' || !('outputQuantity' in metadata) || !('outputUnit' in metadata)) return fallback;
  const { outputQuantity: amount, outputUnit: unit } = metadata;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || typeof unit !== 'string') return fallback;
  try { return { amount, unit: normalizeUnit(unit) }; } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return fallback;
  }
}
