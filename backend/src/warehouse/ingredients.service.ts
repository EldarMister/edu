import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IngredientUnitType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustIngredientDto, CreateIngredientDto, UpdateIngredientDto } from './dto';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import { getWarehouseBalance, resolveWarehouse, setWarehouseBalance, warehouseBalances } from './warehouse-location';
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

type IngredientRow = {
  id: string;
  name: string;
  unitType: IngredientUnitType;
  displayUnit: string;
  stock: Prisma.Decimal;
  avgCost: Prisma.Decimal;
  lowStockThreshold: Prisma.Decimal;
  isActive: boolean;
  isPrepared: boolean;
};

/**
 * Сырьё (ингредиенты). Всё в БД — в базовых единицах (g|ml|pcs); конвертация в
 * display-единицу админа происходит на границе (serialize / парсинг ввода).
 * Низкий остаток: stockBase <= lowStockThresholdBase.
 */
@Injectable()
export class IngredientsService {
  constructor(private prisma: PrismaService) {}

  private serialize(i: IngredientRow) {
    const display = i.displayUnit as UnitCode;
    const stockBase = Number(i.stock);
    const thresholdBase = Number(i.lowStockThreshold);
    const avgCostBase = Number(i.avgCost);
    return {
      id: i.id,
      name: i.name,
      unitType: i.unitType,
      baseUnit: baseUnitForType(i.unitType as 'mass' | 'volume' | 'count'),
      displayUnit: display,
      unit: unitLabel(display), // кириллица для UI
      // Значения в display-единице — то, что видит и вводит админ.
      stock: round3(fromBase(stockBase, display)),
      avgCost: round2(costFromBase(avgCostBase, display)), // за display-единицу (напр. 400 с/кг)
      lowStockThreshold: round3(fromBase(thresholdBase, display)),
      costUnitLabel: costUnitLabel(display),
      // Базовые значения — для тех, кому нужна «сырая» цифра.
      stockBase: round3(stockBase),
      avgCostBase,
      isActive: i.isActive,
      isPrepared: i.isPrepared,
      isLow: stockBase <= thresholdBase,
    };
  }

  async findAll(params: { search?: string; includeInactive?: boolean; warehouseId?: string }) {
    const where: Prisma.IngredientWhereInput = {
      ...(params.includeInactive ? {} : { isActive: true }),
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
    };
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(this.prisma, params.warehouseId);
    const items = await this.prisma.ingredient.findMany({ where, orderBy: { name: 'asc' } });
    const balances = await warehouseBalances(this.prisma, warehouse, items);
    return items.map((item) => this.serialize({ ...item, ...balances.get(item.id)! }));
  }

  async overview(warehouseId?: string) {
    const warehouse = warehouseId === undefined ? null : await resolveWarehouse(this.prisma, warehouseId);
    const active = await this.prisma.ingredient.findMany({
      where: { isActive: true },
      select: { id: true, displayUnit: true, stock: true, avgCost: true, lowStockThreshold: true },
    });
    const balances = await warehouseBalances(this.prisma, warehouse, active);
    const totalIngredients = active.length;
    let lowStockCount = 0;
    let costSum = 0;
    for (const i of active) {
      const balance = balances.get(i.id)!;
      if (balance.stock.lte(i.lowStockThreshold)) lowStockCount++;
      // Себестоимость приводим к display-единице, чтобы среднее было в человеко-масштабе.
      costSum += costFromBase(Number(balance.avgCost), i.displayUnit as UnitCode);
    }
    const avgCost = totalIngredients > 0 ? round2(costSum / totalIngredients) : 0;
    return { totalIngredients, lowStockCount, avgCost };
  }

  async create(dto: CreateIngredientDto) {
    const unit = normalizeUnit(dto.unit);
    const type = unitTypeOf(unit);
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    const balance = {
      stock: new Prisma.Decimal(toBase(dto.stock ?? 0, unit)).toDecimalPlaces(3),
      avgCost: new Prisma.Decimal(costToBase(dto.avgCost ?? 0, unit)).toDecimalPlaces(8),
    };
    const ingredient = await this.prisma.$transaction(async (tx) => {
      await lockWarehouseCatalog(tx);
      const created = await tx.ingredient.create({
        data: {
          name: dto.name.trim(),
          unitType: type as IngredientUnitType,
          displayUnit: unit,
          ...(!warehouse || warehouse.isDefault ? balance : {}),
          lowStockThreshold: new Prisma.Decimal(toBase(dto.lowStockThreshold ?? 0, unit)),
        },
      });
      if (warehouse && !warehouse.isDefault && (!balance.stock.isZero() || !balance.avgCost.isZero())) {
        await setWarehouseBalance(tx, warehouse, created.id, balance);
      }
      return created;
    });
    return this.serialize({ ...ingredient, ...balance });
  }

  async update(id: string, dto: UpdateIngredientDto) {
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    return this.prisma.$transaction(async (tx) => {
      await lockIngredients(tx, [id]);
      const current = await this.ensure(id, tx);
      const unit = dto.unit !== undefined ? normalizeUnit(dto.unit) : current.displayUnit as UnitCode;
      const type = unitTypeOf(unit);
      const data: Prisma.IngredientUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
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
      };
      const stockChanged = !before.stock.eq(after.stock);
      const costChanged = !before.avgCost.eq(after.avgCost);
      const updated = await tx.ingredient.update({ where: { id }, data });
      if (stockChanged || costChanged) {
        await setWarehouseBalance(tx, warehouse, id, after);
        const comments: string[] = [];
        if (stockChanged)
          comments.push(`остаток: ${fmt(fromBase(Number(before.stock), unit))} → ${fmt(fromBase(Number(after.stock), unit))} ${unitLabel(unit)}`);
        if (costChanged)
          comments.push(`себестоимость: ${fmt(costFromBase(Number(before.avgCost), unit))} → ${fmt(costFromBase(Number(after.avgCost), unit))} ${costUnitLabel(unit)}`);
        await tx.stockMovement.create({
          data: {
            ingredientId: id,
            warehouseId: warehouse?.id ?? null,
            type: 'correction',
            sourceType: 'manual',
            beforeStock: before.stock,
            change: after.stock.sub(before.stock),
            afterStock: after.stock,
            costAtMoment: after.avgCost,
            comment: `Ручная корректировка (${comments.join(', ')})`,
          },
        });
      }
      return this.serialize({ ...updated, ...after });
    });
  }

  /** Ручная корректировка остатка: добавить / списать / установить (ТЗ §8). */
  async adjust(id: string, dto: AdjustIngredientDto) {
    const warehouse = await resolveWarehouse(this.prisma, dto.warehouseId);
    const unit = normalizeUnit(dto.unit);
    const quantity = new Prisma.Decimal(toBase(dto.quantity, unit)).toDecimalPlaces(3);
    return this.prisma.$transaction(async (tx) => {
      await lockIngredients(tx, [id]);
      const ingredient = await this.ensure(id, tx);
      assertUnitMatchesType(unit, ingredient.unitType);
      const before = await getWarehouseBalance(tx, warehouse, ingredient);
      let stock: Prisma.Decimal;
      let comment: string;
      if (dto.mode === 'add') {
        stock = before.stock.add(quantity);
        comment = `Ручное поступление: +${fmt(dto.quantity)} ${unitLabel(unit)}`;
      } else if (dto.mode === 'writeoff') {
        stock = before.stock.sub(quantity);
        if (stock.lt(0)) throw new BadRequestException('Нельзя списать больше текущего остатка');
        comment = `Ручное списание: -${fmt(dto.quantity)} ${unitLabel(unit)}`;
      } else {
        stock = quantity;
        comment = `Установлен остаток: ${fmt(dto.quantity)} ${unitLabel(unit)}`;
      }

      await setWarehouseBalance(tx, warehouse, id, { stock, avgCost: before.avgCost });
      await tx.stockMovement.create({
        data: {
          ingredientId: id,
          warehouseId: warehouse?.id ?? null,
          type: 'correction',
          sourceType: 'manual',
          beforeStock: before.stock,
          change: stock.sub(before.stock),
          afterStock: stock,
          costAtMoment: before.avgCost,
          comment,
        },
      });
      return this.serialize({ ...ingredient, stock, avgCost: before.avgCost });
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
      const [used, preparationInputs, purchased, movements, balances, documents] = await Promise.all([
        tx.recipeItem.count({ where: { ingredientId: id } }),
        tx.preparationRecipeItem.count({ where: { ingredientId: id } }),
        tx.purchaseItem.count({ where: { ingredientId: id } }),
        tx.stockMovement.count({ where: { ingredientId: id } }),
        tx.warehouseStock.count({ where: { ingredientId: id, stock: { not: 0 } } }),
        tx.warehouseDocumentItem.count({ where: { ingredientId: id } }),
      ]);
      if (used || preparationInputs || purchased || movements || balances || documents || current.isPrepared || !current.stock.isZero()) {
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

  private async ensure(id: string, db: Prisma.TransactionClient = this.prisma) {
    const ingredient = await db.ingredient.findUnique({ where: { id } });
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
function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
