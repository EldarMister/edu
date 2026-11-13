import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import { assertUnitMatchesType, costFromBase, fromBase, normalizeUnit, toBase, unitLabel, unitType as unitTypeOf, type UnitCode } from './units';
import { getWarehouseBalance, resolveWarehouse, setWarehouseBalance, warehouseBalances } from './warehouse-location';

class CreatePreparationDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsString() @MaxLength(16)
  unit: string;
}

class PreparationInputDto {
  @IsString() @IsNotEmpty()
  ingredientId: string;

  @IsNumber() @Min(0.000001)
  quantity: number;

  @IsString() @MaxLength(16)
  unit: string;
}

class PreparationRecipeDto {
  @IsNumber() @Min(0.000001)
  outputQuantity: number;

  @IsString() @MaxLength(16)
  outputUnit: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PreparationInputDto)
  items: PreparationInputDto[];
}

class ProducePreparationDto {
  @IsNumber() @Min(0.000001)
  quantity: number;

  @IsString() @MaxLength(16)
  unit: string;

  @IsOptional() @IsString()
  warehouseId?: string;
}

@Injectable()
export class PreparationProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(warehouseId?: string) {
    const cafeId = this.cafeId();
    const ingredients = await this.prisma.ingredient.findMany({
      where: { cafeId, isPrepared: true, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const warehouse = warehouseId === undefined ? null : await resolveWarehouse(this.prisma, warehouseId);
    const balances = await warehouseBalances(this.prisma, warehouse, ingredients);
    return ingredients.map((ingredient) => {
      const { id, name, displayUnit, unitType } = ingredient;
      const unit = displayUnit as UnitCode;
      const balance = balances.get(id)!;
      return { id, name, displayUnit, unitType, unit: unitLabel(unit),
        stock: fromBase(Number(balance.stock), unit), avgCost: costFromBase(Number(balance.avgCost), unit) };
    });
  }

  async create(dto: CreatePreparationDto) {
    const cafeId = this.cafeId();
    const unit = normalizeUnit(dto.unit);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Укажите название полуфабриката');
    const ingredient = await this.prisma.$transaction(async (tx) => {
      await lockWarehouseCatalog(tx, cafeId);
      return tx.ingredient.create({ data: { cafeId, name, displayUnit: unit, unitType: unitTypeOf(unit), isPrepared: true } });
    });
    return { id: ingredient.id, name, displayUnit: unit, unitType: ingredient.unitType,
      unit: unitLabel(unit), stock: 0, avgCost: 0 };
  }

  async getRecipe(id: string) {
    const ingredient = await this.prepared(this.prisma, id);
    const recipe = await this.prisma.preparationRecipe.findUnique({
      where: { ingredientId: id },
      include: { items: { include: { ingredient: { select: { name: true } } }, orderBy: { ingredientId: 'asc' } } },
    });
    const outputUnit = (recipe?.outputUnit ?? ingredient.displayUnit) as UnitCode;
    return {
      id,
      name: ingredient.name,
      displayUnit: ingredient.displayUnit,
      unitType: ingredient.unitType,
      outputQuantity: recipe ? fromBase(Number(recipe.outputAmount), outputUnit) : 1,
      outputUnit,
      items: recipe?.items.map((item) => ({
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        quantity: fromBase(Number(item.amount), item.unit as UnitCode),
        unit: item.unit,
      })) ?? [],
    };
  }

  async saveRecipe(id: string, dto: PreparationRecipeDto) {
    const cafeId = this.cafeId();
    const ids = dto.items.map((item) => item.ingredientId);
    if (ids.includes(id) || new Set(ids).size !== ids.length) {
      throw new BadRequestException('Укажите разные ингредиенты, исключив сам полуфабрикат');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockRecipe(tx, cafeId, id);
      const output = await this.prepared(tx, id);
      const { unit: outputUnit, amount: outputAmount } = this.amount(dto.outputQuantity, dto.outputUnit, output.unitType);
      const ingredients = await tx.ingredient.findMany({ where: { cafeId, isActive: true, id: { in: ids } } });
      const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
      const items = dto.items.map((item) => {
        const ingredient = byId.get(item.ingredientId);
        if (!ingredient) throw new NotFoundException('Ингредиент техкарты не найден');
        const { unit, amount } = this.amount(item.quantity, item.unit, ingredient.unitType);
        return { cafeId, recipeId: id, ingredientId: item.ingredientId, unit, amount };
      });
      await tx.preparationRecipe.upsert({
        where: { ingredientId: id },
        create: { cafeId, ingredientId: id, outputUnit, outputAmount },
        update: { outputUnit, outputAmount },
      });
      await tx.preparationRecipeItem.deleteMany({ where: { recipeId: id } });
      await tx.preparationRecipeItem.createMany({ data: items });
    });
    return this.getRecipe(id);
  }

  async produce(id: string, dto: ProducePreparationDto) {
    const cafeId = this.cafeId();
    return this.prisma.$transaction(async (tx) => {
      const warehouse = await resolveWarehouse(tx, dto.warehouseId);
      await this.lockRecipe(tx, cafeId, id);
      const recipe = await tx.preparationRecipe.findUnique({ where: { ingredientId: id }, include: { items: true } });
      if (!recipe?.items.length) throw new BadRequestException('Сначала сохраните техкарту полуфабриката');
      const ids = [id, ...recipe.items.map((item) => item.ingredientId)];
      await lockIngredients(tx, ids);
      const output = await this.prepared(tx, id);
      const { unit, amount } = this.amount(dto.quantity, dto.unit, output.unitType);
      const ingredients = await tx.ingredient.findMany({ where: { cafeId, id: { in: ids }, isActive: true } });
      const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
      const batchId = randomUUID();
      let totalCost = new Prisma.Decimal(0);

      for (const item of recipe.items) {
        const ingredient = byId.get(item.ingredientId);
        if (!ingredient) throw new BadRequestException('Ингредиент техкарты недоступен');
        const consumed = item.amount.mul(amount).div(recipe.outputAmount).toDecimalPlaces(3);
        if (consumed.lte(0)) throw new BadRequestException('Увеличьте объём партии');
        const balance = await getWarehouseBalance(tx, warehouse, ingredient);
        if (balance.stock.lt(consumed)) throw new BadRequestException(`Недостаточно сырья «${ingredient.name}» на выбранном складе`);
        const stock = balance.stock.sub(consumed);
        totalCost = totalCost.add(consumed.mul(balance.avgCost));
        await setWarehouseBalance(tx, warehouse, ingredient.id, { stock, avgCost: balance.avgCost });
        await tx.stockMovement.create({ data: {
          ingredientId: ingredient.id, warehouseId: warehouse?.id, type: 'correction', sourceType: 'manual',
          sourceId: batchId, beforeStock: balance.stock, change: consumed.negated(), afterStock: stock,
          costAtMoment: balance.avgCost, comment: `Сырьё для партии «${output.name}»`,
        } });
      }
      const balance = await getWarehouseBalance(tx, warehouse, output);
      const stock = balance.stock.add(amount);
      const positiveStock = Prisma.Decimal.max(balance.stock, 0);
      const avgCost = positiveStock.mul(balance.avgCost).add(totalCost).div(positiveStock.add(amount));
      await setWarehouseBalance(tx, warehouse, id, { stock, avgCost });
      await tx.stockMovement.create({ data: {
        ingredientId: id, warehouseId: warehouse?.id, type: 'correction', sourceType: 'manual',
        sourceId: batchId, beforeStock: balance.stock, change: amount, afterStock: stock,
        costAtMoment: totalCost.div(amount), comment: `Выпуск партии «${output.name}»`,
      } });
      return { batchId, quantity: fromBase(Number(amount), unit), unit, warehouseId: warehouse?.id ?? null,
        totalCost: Number(totalCost.toDecimalPlaces(2)) };
    });
  }

  private cafeId() {
    const cafeId = getCafeId();
    if (!cafeId) throw new BadRequestException('Заведение не назначено');
    return cafeId;
  }

  private async prepared(tx: Prisma.TransactionClient, id: string) {
    const ingredient = await tx.ingredient.findFirst({ where: { id, cafeId: this.cafeId(), isPrepared: true, isActive: true } });
    if (!ingredient) throw new NotFoundException('Полуфабрикат не найден');
    return ingredient;
  }

  private amount(quantity: number, unitInput: string, unitType: 'mass' | 'volume' | 'count') {
    const unit = normalizeUnit(unitInput);
    assertUnitMatchesType(unit, unitType);
    const amount = new Prisma.Decimal(toBase(quantity, unit)).toDecimalPlaces(3);
    if (amount.lte(0) || amount.gte(100_000_000_000)) throw new BadRequestException('Количество вне допустимого диапазона');
    return { unit, amount };
  }

  private async lockRecipe(tx: Prisma.TransactionClient, cafeId: string, id: string) {
    const key = `preparation-recipe:${cafeId}:${id}`;
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS recipe_lock`;
  }
}

@Controller('admin/warehouse/preparation')
@Roles(Role.OWNER, Role.ADMIN)
@RequirePermission('sections.warehouse')
class PreparationProductionController {
  constructor(private readonly preparation: PreparationProductionService) {}

  @Get()
  list(@Query('warehouseId') warehouseId?: string) { return this.preparation.list(warehouseId); }

  @Post()
  create(@Body() dto: CreatePreparationDto) { return this.preparation.create(dto); }

  @Get(':id/recipe')
  recipe(@Param('id') id: string) { return this.preparation.getRecipe(id); }

  @Put(':id/recipe')
  saveRecipe(@Param('id') id: string, @Body() dto: PreparationRecipeDto) { return this.preparation.saveRecipe(id, dto); }

  @Post(':id/batches')
  produce(@Param('id') id: string, @Body() dto: ProducePreparationDto) { return this.preparation.produce(id, dto); }
}

@Module({ controllers: [PreparationProductionController], providers: [PreparationProductionService] })
export class PreparationProductionModule {}
