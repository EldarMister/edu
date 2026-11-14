import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import { assertUnitMatchesType, costFromBase, fromBase, normalizeUnit, toBase, unitLabel, unitType as unitTypeOf, type UnitCode } from './units';
import { getWarehouseBalance, resolveWarehouse, warehouseBalances } from './warehouse-location';
import { IngredientsService } from './ingredients.service';
import { lockRecipeGraph, RecipeResolver, warehouseKey } from './recipe-resolution';
import { postStockMovement } from './stock-posting';

class CreatePreparationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @MaxLength(16) unit: string;
}
class PreparationInputDto {
  @IsString() @IsNotEmpty() ingredientId: string;
  @IsNumber() @Min(0.000001) quantity: number;
  @IsString() @MaxLength(16) unit: string;
  @IsOptional() @IsNumber() @Min(0) netAmount?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) lossPercent?: number;
  @IsOptional() @IsIn(['cleaning', 'boiling', 'frying', 'stewing', 'baking']) processingMethod?: string | null;
}
class PreparationRecipeDto {
  @IsNumber() @Min(0.000001) outputQuantity: number;
  @IsString() @MaxLength(16) outputUnit: string;
  @IsOptional() @IsString() @MaxLength(12000) instructions?: string;
  @IsOptional() @IsIn(['virtual', 'stocked']) mode?: 'virtual' | 'stocked';
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PreparationInputDto) items: PreparationInputDto[];
}
class PreparationCardDto extends PreparationRecipeDto {
  @IsOptional() @IsString() @MaxLength(40) expectedUpdatedAt?: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @MaxLength(16) unit: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string | null;
  @IsOptional() @IsString() @MaxLength(100) requestKey?: string;
}
class ProducePreparationDto {
  @IsNumber() @Min(0.000001) quantity: number;
  @IsString() @MaxLength(16) unit: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsNumber() @Min(0.000001) plannedQuantity?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PreparationInputDto) items?: PreparationInputDto[];
  @IsOptional() @IsString() @MaxLength(100) requestKey?: string;
  @IsOptional() @IsString() @MaxLength(100) batchNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) expiresAt?: string;
}
class ReversePreparationDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) reason: string;
}

@Injectable()
export class PreparationProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(warehouseId?: string) {
    const cafeId = this.cafeId();
    const ingredients = await this.prisma.ingredient.findMany({ where: { cafeId, isPrepared: true, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    const warehouse = warehouseId === undefined ? null : await resolveWarehouse(this.prisma, warehouseId);
    const balances = await warehouseBalances(this.prisma, warehouse, ingredients);
    return ingredients.map((ingredient) => {
      const unit = ingredient.displayUnit as UnitCode, balance = balances.get(ingredient.id)!;
      return { id: ingredient.id, name: ingredient.name, displayUnit: unit, unitType: ingredient.unitType, mode: ingredient.preparationMode,
        unit: unitLabel(unit), stock: fromBase(Number(balance.stock), unit), costKnown: balance.valuationKnown,
        avgCost: balance.valuationKnown ? costFromBase(Number(balance.avgCost), unit) : null };
    });
  }

  async create(dto: CreatePreparationDto) {
    // Compatibility endpoint uses the same catalog creation logic as the common item card.
    return new IngredientsService(this.prisma).create({ name: dto.name, unit: dto.unit, kind: 'preparation' });
  }

  async getRecipe(id: string, warehouseId?: string) {
    const ingredient = await this.prepared(this.prisma, id);
    const recipe = await this.prisma.preparationRecipe.findUnique({
      where: { ingredientId: id }, include: { items: { include: { ingredient: true }, orderBy: { ingredientId: 'asc' } } },
    });
    const outputUnit = (recipe?.outputUnit ?? ingredient.displayUnit) as UnitCode;
    const warehouse = warehouseId ? await resolveWarehouse(this.prisma, warehouseId) : null;
    let totalCost = new Prisma.Decimal(0);
    const itemCosts = new Map<string, { cost: Prisma.Decimal; known: boolean }>();
    const missingCosts = new Set<string>(), resolver = new RecipeResolver(this.prisma, { allowInactive: true });
    for (const item of recipe?.items ?? []) {
      let rowCost = new Prisma.Decimal(0), rowKnown = true;
      for (const part of await resolver.expand(item.ingredientId, item.amount, warehouse)) {
        const balance = await getWarehouseBalance(this.prisma, warehouse, part.ingredient);
        rowCost = rowCost.add(part.amount.mul(balance.avgCost));
        if (!balance.valuationKnown) { missingCosts.add(part.ingredient.name); rowKnown = false; }
      }
      totalCost = totalCost.add(rowCost); itemCosts.set(item.ingredientId, { cost: rowCost, known: rowKnown });
    }
    return { id, updatedAt: ingredient.updatedAt.toISOString(), name: ingredient.name, category: ingredient.category, displayUnit: ingredient.displayUnit, unitType: ingredient.unitType, mode: ingredient.preparationMode,
      instructions: recipe?.instructions ?? '', outputQuantity: recipe ? fromBase(Number(recipe.outputAmount), outputUnit) : 1, outputUnit, totalCost: missingCosts.size || !recipe?.items.length ? null : Number(totalCost.toDecimalPlaces(2)), costKnown: !missingCosts.size && !!recipe?.items.length, missingCosts: [...missingCosts],
      items: recipe?.items.map((item) => ({ ingredientId: item.ingredientId, name: item.ingredient.name, lineCost: itemCosts.get(item.ingredientId)?.known ? Number(itemCosts.get(item.ingredientId)!.cost.toDecimalPlaces(2)) : null, costKnown: itemCosts.get(item.ingredientId)?.known ?? false, quantity: fromBase(Number(item.amount), item.unit as UnitCode), netAmount: item.netAmount == null ? null : fromBase(Number(item.netAmount), item.unit as UnitCode), lossPercent: Number(item.lossPercent), processingMethod: item.processingMethod, unit: item.unit })) ?? [] };
  }

  async saveRecipe(id: string, dto: PreparationRecipeDto) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await lockIngredients(tx, [id]);
      await this.writeRecipe(tx, id, dto);
    });
    return this.getRecipe(id);
  }

  async saveCard(dto: PreparationCardDto, id?: string) {
    const cafeId = this.cafeId();
    if (!dto.name?.trim()) throw new BadRequestException('Укажите название полуфабриката');
    const unit = normalizeUnit(dto.unit);
    const targetId = id ?? (dto.requestKey
      ? 'preparation:' + createHash('sha256').update(cafeId + ':' + dto.requestKey).digest('hex')
      : randomUUID());
    await this.prisma.$transaction(async (tx) => {
      await lockWarehouseCatalog(tx);
      await lockRecipeGraph(tx);
      await lockIngredients(tx, [targetId]);
      const existing = await tx.ingredient.findFirst({ where: { id: targetId, cafeId } });
      if (id) {
        if (!existing?.isPrepared || !existing.isActive) throw new NotFoundException('Полуфабрикат не найден');
        if (dto.expectedUpdatedAt !== existing.updatedAt.toISOString()) throw new ConflictException('Полуфабрикат уже изменён. Обновите страницу перед сохранением.');
        if (existing.displayUnit !== unit) throw new BadRequestException('Единица измерения существующего полуфабриката не меняется');
        await tx.ingredient.update({ where: { id, cafeId }, data: { name: dto.name.trim(), category: dto.category?.trim() || null } });
      } else if (existing) {
        // The same create request may arrive after a response was lost. It must
        // return its original record rather than create another preparation.
        await this.assertSameCard(tx, targetId, dto);
        return;
      } else {
        await tx.ingredient.create({ data: { id: targetId, cafeId, name: dto.name.trim(), category: dto.category?.trim() || null,
          unitType: unitTypeOf(unit), displayUnit: unit, kind: 'preparation', isPrepared: true, preparationMode: dto.mode ?? 'virtual' } });
      }
      await this.writeRecipe(tx, targetId, dto);
    });
    return this.getRecipe(targetId);
  }

  private async assertSameCard(tx: Prisma.TransactionClient, id: string, dto: PreparationCardDto) {
    const ingredient = await this.prepared(tx, id);
    const recipe = await tx.preparationRecipe.findUnique({ where: { ingredientId: id }, include: { items: { include: { ingredient: true } } } });
    const amount = (quantity: number, unit: string) => new Prisma.Decimal(quantity).mul(toBase(1, normalizeUnit(unit))).toDecimalPlaces(3);
    let matches = ingredient.name === dto.name.trim() && ingredient.category === (dto.category?.trim() || null) &&
      ingredient.displayUnit === normalizeUnit(dto.unit) && ingredient.preparationMode === (dto.mode ?? 'virtual') &&
      recipe?.outputUnit === normalizeUnit(dto.outputUnit) && recipe.outputAmount.eq(amount(dto.outputQuantity, dto.outputUnit)) &&
      (recipe.instructions ?? '') === (dto.instructions ?? '') && recipe.items.length === dto.items.length;
    for (const input of dto.items) {
      const saved = recipe?.items.find((item) => item.ingredientId === input.ingredientId);
      const gross = amount(input.quantity, input.unit);
      const loss = input.lossPercent ?? Number((saved?.ingredient.processingLosses as Record<string, number> | null)?.[input.processingMethod ?? ''] ?? 0);
      const net = input.netAmount === undefined ? gross.mul(100 - loss).div(100).toDecimalPlaces(3) : amount(input.netAmount, input.unit);
      matches = matches && !!saved && saved.unit === normalizeUnit(input.unit) && saved.amount.eq(gross) &&
        !!saved.netAmount?.eq(net) && (saved.processingMethod ?? null) === (input.processingMethod ?? null);
    }
    if (!matches) throw new BadRequestException('Ключ создания уже использован с другим названием или составом полуфабриката');
  }

  private async writeRecipe(tx: Prisma.TransactionClient, id: string, dto: PreparationRecipeDto) {
    const cafeId = this.cafeId();
    const ids = dto.items.map((item) => item.ingredientId);
    if (!ids.length || ids.includes(id) || new Set(ids).size !== ids.length) throw new BadRequestException('Укажите разные ингредиенты, исключив сам полуфабрикат');
    const output = await this.prepared(tx, id);
    const { unit: outputUnit, amount: outputAmount } = this.amount(dto.outputQuantity, dto.outputUnit, output.unitType);
    const mode = dto.mode ?? output.preparationMode;
    if (!['virtual', 'stocked'].includes(mode)) throw new BadRequestException('Неизвестный режим заготовки');
    if (mode === 'virtual' && output.preparationMode !== mode) {
      const balances = await tx.warehouseStock.findMany({ where: { ingredientId: id } });
      if (!output.stock.isZero() || balances.some((balance) => !balance.stock.isZero())) throw new BadRequestException('Сначала израсходуйте или спишите остаток заготовки перед переходом в режим без остатка');
      if (await tx.dish.count({ where: { stockIngredientId: id } }) || await tx.dishVariant.count({ where: { stockIngredientId: id } })) throw new BadRequestException('Сначала отключите прямую продажу этой заготовки');
    }
    const ingredients = await tx.ingredient.findMany({ where: { cafeId, isActive: true, id: { in: ids } } });
    const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
    const items = dto.items.map((item) => {
      const ingredient = byId.get(item.ingredientId);
      if (!ingredient) throw new NotFoundException('Ингредиент техкарты не найден');
      const gross = this.amount(item.quantity, item.unit, ingredient.unitType);
      const lossPercent = item.lossPercent ?? Number((ingredient.processingLosses as Record<string, number> | null)?.[item.processingMethod ?? ''] ?? 0);
      if (!Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent > 100) throw new BadRequestException('Проверьте процент потерь');
      const netAmount = item.netAmount === undefined ? gross.amount.mul(100 - lossPercent).div(100).toDecimalPlaces(3) : new Prisma.Decimal(item.netAmount).mul(toBase(1, gross.unit)).toDecimalPlaces(3);
      if (netAmount.lt(0) || netAmount.gt(gross.amount)) throw new BadRequestException('Нетто должно быть от нуля до брутто');
      return { cafeId, recipeId: id, ingredientId: item.ingredientId, ...gross, netAmount, lossPercent: item.netAmount !== undefined ? new Prisma.Decimal(100).sub(netAmount.mul(100).div(gross.amount)).toDecimalPlaces(2) : lossPercent, processingMethod: item.processingMethod };
    });
    const edges = await tx.preparationRecipeItem.findMany({ where: { cafeId }, select: { recipeId: true, ingredientId: true } });
    const graph = new Map<string, string[]>();
    for (const edge of edges) if (edge.recipeId !== id) graph.set(edge.recipeId, [...(graph.get(edge.recipeId) ?? []), edge.ingredientId]);
    graph.set(id, ids);
    const visit = (node: string, path: Set<string>) => {
      if (path.has(node)) throw new BadRequestException('Рецептура создаёт циклическую зависимость заготовок');
      if (path.size > 32) throw new BadRequestException('Слишком много уровней рецептуры');
      const next = new Set([...path, node]);
      for (const child of graph.get(node) ?? []) visit(child, next);
    };
    visit(id, new Set());
    await tx.ingredient.update({ where: { id }, data: { preparationMode: mode } });
    await tx.preparationRecipe.upsert({ where: { ingredientId: id }, create: { cafeId, ingredientId: id, outputUnit, outputAmount, instructions: dto.instructions }, update: { outputUnit, outputAmount, instructions: dto.instructions } });
    await tx.preparationRecipeItem.deleteMany({ where: { recipeId: id } });
    await tx.preparationRecipeItem.createMany({ data: items });
  }

  async produce(id: string, dto: ProducePreparationDto, actor?: Pick<AuthUser, 'id' | 'name'>) {
    const cafeId = this.cafeId();
    return this.prisma.$transaction(async (tx) => {
      const requestKey = dto.requestKey?.trim() || randomUUID();
      const key = 'production:' + cafeId + ':' + requestKey;
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS production_lock`;
      const requestFingerprint = this.productionFingerprint(id, dto);
      const previous = await tx.preparationBatch.findUnique({ where: { cafeId_requestKey: { cafeId, requestKey } } });
      if (previous) {
        if (previous.ingredientId !== id) throw new BadRequestException('Ключ повторной операции принадлежит другой заготовке');
        const previousFingerprint = (previous.items as { requestFingerprint?: string } | null)?.requestFingerprint;
        if (previousFingerprint && previousFingerprint !== requestFingerprint) throw new BadRequestException('Ключ повторной операции уже использован с другим составом или реквизитами партии');
        if (!previousFingerprint) throw new BadRequestException('Для старой партии используйте её документ; повторный запрос без сохранённого состава не допускается');
        const ingredient = await this.prepared(tx, id);
        const requestedAmount = this.amount(dto.quantity, dto.unit, ingredient.unitType).amount;
        if (!previous.actualQuantity.eq(requestedAmount) || (dto.warehouseId && dto.warehouseId !== previous.warehouseId)) throw new BadRequestException('Ключ повторной операции уже использован с другим количеством или складом');
        return this.serializeBatch(previous, ingredient);
      }
      await lockRecipeGraph(tx);
      const warehouse = await resolveWarehouse(tx, dto.warehouseId);
      if (!warehouse) throw new BadRequestException('Выберите склад производства');
      const output = await this.prepared(tx, id);
      if (output.preparationMode === 'virtual') throw new BadRequestException('Эта заготовка раскрывается в сырьё при продаже. Для производства включите отдельный остаток');
      const recipe = await tx.preparationRecipe.findUnique({ where: { ingredientId: id }, include: { items: true } });
      if (!recipe?.items.length) throw new BadRequestException('Сначала сохраните техкарту полуфабриката');
      const { unit, amount } = this.amount(dto.quantity, dto.unit, output.unitType);
      const planned = this.amount(dto.plannedQuantity ?? dto.quantity, dto.unit, output.unitType).amount;
      const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new BadRequestException('Срок годности должен быть действительной будущей датой');
      const inputIds = dto.items?.map((item) => item.ingredientId);
      if (inputIds && new Set(inputIds).size !== inputIds.length) throw new BadRequestException('Не повторяйте сырьё в фактическом расходе');
      const raw = dto.items ? await tx.ingredient.findMany({ where: { id: { in: inputIds }, isActive: true } }) : [];
      const rawById = new Map(raw.map((ingredient) => [ingredient.id, ingredient]));
      const inputs = dto.items ? dto.items.map((item) => {
        const ingredient = rawById.get(item.ingredientId);
        if (!ingredient) throw new NotFoundException('Фактическое сырьё не найдено');
        return { ingredientId: item.ingredientId, ...this.amount(item.quantity, item.unit, ingredient.unitType) };
      }) : recipe.items.map((item) => ({ ingredientId: item.ingredientId, amount: item.amount.mul(planned).div(recipe.outputAmount), unit: item.unit }));
      const resolver = new RecipeResolver(tx), parts: Awaited<ReturnType<RecipeResolver['expand']>> = [];
      for (const input of inputs) parts.push(...await resolver.expand(input.ingredientId, input.amount, warehouse, [id]));
      await lockIngredients(tx, [id, ...parts.map((part) => part.ingredient.id)]);
      const grouped = new Map<string, { ingredient: typeof output; amount: Prisma.Decimal }>();
      for (const part of parts) {
        const prior = grouped.get(part.ingredient.id);
        grouped.set(part.ingredient.id, { ingredient: part.ingredient, amount: (prior?.amount ?? new Prisma.Decimal(0)).add(part.amount) });
      }
      let totalCost = new Prisma.Decimal(0);
      let costKnown = true;
      const batchId = randomUUID(), actualItems: Prisma.InputJsonValue[] = [];
      for (const { ingredient, amount: unrounded } of grouped.values()) {
        const consumed = unrounded.toDecimalPlaces(3);
        if (consumed.lte(0)) throw new BadRequestException('Увеличьте объём партии: расход меньше точности учёта');
        const fresh = await tx.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
        const balance = await getWarehouseBalance(tx, warehouse, fresh);
        if (balance.stock.lt(consumed)) throw new BadRequestException('Недостаточно сырья «' + ingredient.name + '» на выбранном складе');
        const cost = consumed.mul(balance.avgCost);
        costKnown = costKnown && balance.valuationKnown;
        totalCost = totalCost.add(cost);
        actualItems.push({ ingredientId: ingredient.id, name: ingredient.name, amount: consumed.toString(), unit: ingredient.displayUnit,
          quantity: fromBase(Number(consumed), ingredient.displayUnit as UnitCode), cost: cost.toString(), costAtMoment: balance.avgCost.toString(), costKnown: balance.valuationKnown });
        await postStockMovement(tx, { ingredientId: ingredient.id, warehouse, change: consumed.negated(),
          movement: { type: 'production', sourceType: 'production', sourceId: batchId, actorId: actor?.id, actorName: actor?.name,
            comment: 'Производство ' + (dto.batchNumber ?? batchId) + ': сырьё для «' + output.name + '»' } });
      }
      await postStockMovement(tx, { ingredientId: id, warehouse, change: amount, cost: totalCost.div(amount), costKnown, valuation: 'average',
        movement: { type: 'production', sourceType: 'production', sourceId: batchId, actorId: actor?.id, actorName: actor?.name,
          comment: 'Производство ' + (dto.batchNumber ?? batchId) + ': выпуск «' + output.name + '»' } });
      const batch = await tx.preparationBatch.create({ data: { id: batchId, cafeId, warehouseId: warehouse.id, ingredientId: id, requestKey,
        plannedQuantity: planned, actualQuantity: amount, totalCost: totalCost.toDecimalPlaces(2), costKnown, items: { requestFingerprint, actual: actualItems,
          recipe: recipe.items.map((item) => ({ ingredientId: item.ingredientId, amount: item.amount.toString(), unit: item.unit, netAmount: item.netAmount?.toString() ?? null, lossPercent: item.lossPercent.toString(), processingMethod: item.processingMethod })),
          recipeInstructions: recipe.instructions, recipeOutputAmount: recipe.outputAmount.toString(), preparationRecipes: [...new Map(parts.flatMap((part) => part.preparations).map((snapshot) => [snapshot.signature, snapshot])).values()],
          actorId: actor?.id ?? null, actorName: actor?.name ?? null }, expiresAt, batchNumber: dto.batchNumber } });
      return this.serializeBatch(batch, output, unit);
    });
  }

  async journal(warehouseId?: string) {
    const cafeId = this.cafeId();
    return this.prisma.$transaction(async (tx) => {
      const warehouse = warehouseId === undefined ? null : await resolveWarehouse(tx, warehouseId);
      const batches = await tx.preparationBatch.findMany({
        where: { cafeId, ...(warehouse ? { warehouseId: warehouse.id } : {}) },
        orderBy: [{ producedAt: 'desc' }, { id: 'desc' }], take: 200,
      });
      const ingredients = await tx.ingredient.findMany({ where: { cafeId, id: { in: [...new Set(batches.map((batch) => batch.ingredientId))] } } });
      const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
      return batches.map((batch) => {
        const ingredient = byId.get(batch.ingredientId);
        if (!ingredient) throw new NotFoundException('Складская позиция производственной партии не найдена');
        return this.serializeBatch(batch, ingredient);
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async batches(id: string) {
    const ingredient = await this.prepared(this.prisma, id);
    return (await this.prisma.preparationBatch.findMany({ where: { ingredientId: id, cafeId: this.cafeId() }, orderBy: { producedAt: 'desc' }, take: 100 }))
      .map((batch) => this.serializeBatch(batch, ingredient));
  }
  async batch(id: string) {
    const batch = await this.prisma.preparationBatch.findFirst({ where: { id, cafeId: this.cafeId() } });
    if (!batch) throw new NotFoundException('Производственная партия не найдена');
    const ingredient = await this.prisma.ingredient.findUniqueOrThrow({ where: { id: batch.ingredientId } });
    return this.serializeBatch(batch, ingredient);
  }

  async reverse(id: string, reason: string, actor: Pick<AuthUser, 'id' | 'name'>) {
    if (!reason?.trim()) throw new BadRequestException('Укажите причину сторнирования производства');
    const cafeId = this.cafeId();
    return this.prisma.$transaction(async (tx) => {
      const key = 'production-batch:' + cafeId + ':' + id;
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS batch_reverse_lock`;
      const batch = await tx.preparationBatch.findFirst({ where: { id, cafeId } });
      if (!batch) throw new NotFoundException('Производственная партия не найдена');
      const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id: batch.ingredientId } });
      if (batch.reversedAt) return this.serializeBatch(batch, ingredient);
      const movements = await tx.stockMovement.findMany({ where: { sourceType: 'production', sourceId: id, type: { in: ['production', 'correction'] } }, include: { warehouse: true } });
      if (!movements.length) throw new BadRequestException('Исходные движения производства не найдены');
      await lockIngredients(tx, movements.map((movement) => movement.ingredientId));
      // Remove the produced output first; consumed/transferred output cannot be silently restored.
      for (const movement of movements.sort((a, b) => Number(b.change) - Number(a.change))) await postStockMovement(tx, {
        ingredientId: movement.ingredientId, warehouse: movement.warehouse, change: movement.change.negated(), cost: movement.costAtMoment, costKnown: movement.costKnown, valuation: 'value', allowNegative: false,
        movement: { type: 'cancel', sourceType: 'production', sourceId: id, actorId: actor.id, actorName: actor.name,
          comment: 'Сторно производства: ' + reason.trim(), recipeSnapshot: { productionReversal: true, originalMovementId: movement.id, reason: reason.trim() } },
      });
      const updated = await tx.preparationBatch.update({ where: { id }, data: { reversedAt: new Date(), reverseReason: reason.trim(), reversedById: actor.id } });
      return this.serializeBatch(updated, ingredient);
    });
  }
  private productionFingerprint(id: string, dto: ProducePreparationDto) {
    const base = (quantity: number, unit: string) => new Prisma.Decimal(quantity).mul(toBase(1, normalizeUnit(unit))).toDecimalPlaces(3).toString();
    const date = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (date && !Number.isFinite(date.getTime())) throw new BadRequestException('Укажите действительную дату срока годности');
    return createHash('sha256').update(JSON.stringify({ id, quantity: base(dto.quantity, dto.unit), planned: base(dto.plannedQuantity ?? dto.quantity, dto.unit), warehouseId: dto.warehouseId ?? null,
      items: dto.items?.map((item) => ({ ingredientId: item.ingredientId, amount: base(item.quantity, item.unit) })).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId)) ?? null,
      batchNumber: dto.batchNumber?.trim() ?? '', expiresAt: date?.toISOString() ?? null })).digest('hex');
  }
  private serializeBatch(batch: Prisma.PreparationBatchGetPayload<{}>, ingredient: Prisma.IngredientGetPayload<{}>, unit = ingredient.displayUnit as UnitCode) {
    const savedItems = batch.items as { actual?: Record<string, unknown>[] } | null;
    const items = savedItems && { ...savedItems, actual: savedItems.actual?.map((item) => {
      const known = typeof item.costKnown === 'boolean' ? item.costKnown : batch.costKnown;
      return { ...item, costKnown: known, cost: known ? item.cost : null, costAtMoment: known ? item.costAtMoment : null };
    }) };
    return { ...batch, items, batchId: batch.id, ingredientName: ingredient.name, quantity: fromBase(Number(batch.actualQuantity), unit), unit,
      plannedQuantity: fromBase(Number(batch.plannedQuantity), unit), actualQuantity: fromBase(Number(batch.actualQuantity), unit),
      yieldDifference: fromBase(Number(batch.actualQuantity.sub(batch.plannedQuantity)), unit), totalCost: batch.costKnown ? Number(batch.totalCost) : null,
      unitCost: batch.costKnown ? Number(batch.totalCost.div(batch.actualQuantity).mul(toBase(1, unit)).toDecimalPlaces(2)) : null };
  }
  private cafeId() { const cafeId = getCafeId(); if (!cafeId) throw new BadRequestException('Заведение не назначено'); return cafeId; }
  private async prepared(tx: Prisma.TransactionClient, id: string) {
    const ingredient = await tx.ingredient.findFirst({ where: { id, cafeId: this.cafeId(), isPrepared: true, isActive: true } });
    if (!ingredient) throw new NotFoundException('Полуфабрикат не найден');
    return ingredient;
  }
  private amount(quantity: number, unitInput: string, unitType: 'mass' | 'volume' | 'count') {
    const unit = normalizeUnit(unitInput);
    assertUnitMatchesType(unit, unitType);
    if (!Number.isFinite(quantity)) throw new BadRequestException('Укажите количество');
    const amount = new Prisma.Decimal(quantity).mul(toBase(1, unit)).toDecimalPlaces(3);
    if (amount.lte(0) || amount.gte(100_000_000_000)) throw new BadRequestException('Количество вне допустимого диапазона');
    return { unit, amount };
  }
}

@Controller('admin/warehouse/preparation')
@Roles(Role.OWNER, Role.ADMIN, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
class PreparationProductionController {
  constructor(private readonly preparation: PreparationProductionService) {}
  @Get() list(@Query('warehouseId') warehouseId?: string) { return this.preparation.list(warehouseId); }
  @Post() @RequirePermission('actions.warehouseRecipes')
  create(@Body() dto: CreatePreparationDto) { return this.preparation.create(dto); }
  @Post('card') @RequirePermission('actions.warehouseRecipes')
  createCard(@Body() dto: PreparationCardDto) { return this.preparation.saveCard(dto); }
  @Put(':id/card') @RequirePermission('actions.warehouseRecipes')
  updateCard(@Param('id') id: string, @Body() dto: PreparationCardDto) { return this.preparation.saveCard(dto, id); }
  @Get('batches') @RequirePermission('actions.warehouseProduce')
  journal(@Query('warehouseId') warehouseId?: string) { return this.preparation.journal(warehouseId); }
  @Get('batches/:batchId') batch(@Param('batchId') id: string) { return this.preparation.batch(id); }
  @Post('batches/:batchId/reverse') @Roles(Role.OWNER, Role.ADMIN) @RequirePermission('actions.warehouseApprove')
  reverse(@Param('batchId') id: string, @Body() dto: ReversePreparationDto, @CurrentUser() actor: AuthUser) { return this.preparation.reverse(id, dto.reason, actor); }
  @Get(':id/batches') batches(@Param('id') id: string) { return this.preparation.batches(id); }
  @Get(':id/recipe') recipe(@Param('id') id: string, @Query('warehouseId') warehouseId?: string) { return this.preparation.getRecipe(id, warehouseId); }
  @Put(':id/recipe') @RequirePermission('actions.warehouseRecipes')
  saveRecipe(@Param('id') id: string, @Body() dto: PreparationRecipeDto) { return this.preparation.saveRecipe(id, dto); }
  @Post(':id/batches') @RequirePermission('actions.warehouseProduce')
  produce(@Param('id') id: string, @Body() dto: ProducePreparationDto, @CurrentUser() actor: AuthUser) { return this.preparation.produce(id, dto, actor); }
}
@Module({ controllers: [PreparationProductionController], providers: [PreparationProductionService] })
export class PreparationProductionModule {}
