import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { getCafeId } from '../tenant/tenant-context';
import type { WriteoffSourceLineDto } from './documents.dto';
import { RecipeResolver, recipeAmount, recipeRowsForVariant } from './recipe-resolution';
import { writeoffRecipeVersion } from './recipe-revisions';
import { assertUnitMatchesType, costFromBase, fromBase, normalizeUnit, toBase, unitLabel, type UnitCode } from './units';
import { warehouseBalances, type WarehouseLocation } from './warehouse-location';

type SourcePart = { ingredientId: string; name: string; unit: UnitCode; amountBase: string };
export type WriteoffPackageSnapshot = { packageId: string; packageName: string; packageQuantity: number; packageUnit: UnitCode; packageFactor: number };
export type WriteoffSourceLine = {
  sourceLineId: string; kind: 'ingredient' | 'dish'; sourceId: string; variantId?: string;
  name: string; quantity: number; unit: UnitCode; recipeSignature: string; details?: string;
  parts: SourcePart[]; recipe: Prisma.InputJsonValue;
} & Partial<WriteoffPackageSnapshot>;
export type WriteoffSnapshot = { version: 1; lines: WriteoffSourceLine[] };
const zero = new Prisma.Decimal(0);

export function writeoffDishUnit(dish: { isWeighted: boolean; weightedMeasure: string }): 'pcs' | 'g' | 'ml' {
  if (!dish.isWeighted) return 'pcs';
  return dish.weightedMeasure === 'volume' ? 'ml' : 'g';
}

export function writeoffDishAvailability(date?: Date | null): Prisma.DishWhereInput {
  return date ? { createdAt: { lte: date }, OR: [{ isActive: true }, { archivedAt: { gt: date }, activeBeforeArchive: true }] } : { isActive: true };
}

export function readWriteoffSnapshot(value: Prisma.JsonValue | null): WriteoffSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.lines)) return null;
  return value as unknown as WriteoffSnapshot;
}

/** Caller holds the shared recipe graph lock before any ingredient locks. */
export async function resolveWriteoffSources(tx: Prisma.TransactionClient, warehouse: WarehouseLocation,
  inputs: WriteoffSourceLineDto[], requireSignatures = false, allowEmpty = false, savedSnapshot?: WriteoffSnapshot | null,
  effectiveAt?: Date | null, preserveMatching = false): Promise<WriteoffSnapshot> {
  if (!Array.isArray(inputs) || (!allowEmpty && !inputs.length) || inputs.length > 200) throw new BadRequestException('Добавьте продукты для списания');
  if (new Set(inputs.map((line) => line.sourceLineId)).size !== inputs.length) throw new BadRequestException('Строка списания указана несколько раз');
  const resolver = new RecipeResolver(tx, { effectiveAt, allowInactive: !!effectiveAt });
  const previousLines = new Map(savedSnapshot?.lines.map(line => [line.sourceLineId, line]));
  const packageIds = [...new Set(inputs.flatMap((input) => input.packageId && !input.packageSnapshotLineId ? [input.packageId] : []))];
  const packages = new Map((packageIds.length ? await tx.warehousePackage.findMany({ where: { cafeId: warehouse.cafeId, id: { in: packageIds }, isActive: true } }) : []).map((pack) => [pack.id, pack]));
  const lines: WriteoffSourceLine[] = [];
  for (const input of inputs) {
    if (!input.sourceLineId?.trim() || !Number.isFinite(input.quantity) || input.quantity <= 0) throw new BadRequestException('Укажите продукт и количество больше нуля');
    const previousLine = previousLines.get(input.sourceLineId);
    if (preserveMatching && previousLine && previousLine.kind === input.kind && previousLine.sourceId === input.sourceId &&
      previousLine.variantId === input.variantId && previousLine.quantity === input.quantity &&
      previousLine.unit === normalizeUnit(input.unit ?? previousLine.unit) && previousLine.packageId === input.packageId &&
      (!input.packageId || input.packageSnapshotLineId === input.sourceLineId)) {
      if ((requireSignatures && !input.recipeSignature) || (input.recipeSignature && input.recipeSignature !== previousLine.recipeSignature)) {
        throw new ConflictException('Состав изменился. Обновите предварительный расчёт');
      }
      const details = input.details === undefined ? previousLine.details : input.details?.trim() || undefined;
      lines.push({ ...previousLine, details });
      continue;
    }
    let name: string, unit: UnitCode, recipe: Prisma.InputJsonObject;
    let pack: WriteoffPackageSnapshot | undefined;
    if (input.packageSnapshotLineId) {
      const saved = savedSnapshot?.lines.find((line) => line.sourceLineId === input.packageSnapshotLineId);
      if (!input.packageId || !saved || input.packageSnapshotLineId !== input.sourceLineId || saved.kind !== input.kind || saved.sourceId !== input.sourceId ||
        (saved.variantId ?? '') !== (input.variantId ?? '') || saved.packageId !== input.packageId || !saved.packageName || !saved.packageQuantity || !saved.packageUnit || !saved.packageFactor) {
        throw new BadRequestException('Сохранённая фасовка не относится к этой строке списания');
      }
      pack = { packageId: saved.packageId, packageName: saved.packageName, packageQuantity: saved.packageQuantity, packageUnit: saved.packageUnit, packageFactor: saved.packageFactor };
    } else if (input.packageId) {
      const selected = packages.get(input.packageId);
      if (!selected) throw new BadRequestException('Фасовка не найдена или находится в архиве');
      pack = { packageId: selected.id, packageName: selected.name, packageQuantity: Number(selected.quantity), packageUnit: normalizeUnit(selected.unit), packageFactor: Number(selected.quantityBase) };
    }
    if (pack && (!Number.isFinite(pack.packageFactor) || pack.packageFactor <= 0 || !Number.isFinite(pack.packageQuantity) || pack.packageQuantity <= 0)) throw new BadRequestException('Некорректное количество в фасовке');
    const roots: Array<{ ingredientId: string; amount: Prisma.Decimal }> = [];
    if (input.kind === 'ingredient') {
      if (input.variantId) throw new BadRequestException('Вариант доступен только для блюда');
      const ingredient = await tx.ingredient.findFirst({ where: { id: input.sourceId, cafeId: warehouse.cafeId, isActive: true } });
      if (!ingredient) throw new BadRequestException('Продукт недоступен для списания');
      unit = normalizeUnit(input.unit ?? ingredient.displayUnit);
      assertUnitMatchesType(unit, ingredient.unitType);
      if (pack) assertUnitMatchesType(pack.packageUnit, ingredient.unitType);
      name = ingredient.name;
      roots.push({ ingredientId: ingredient.id, amount: new Prisma.Decimal(input.quantity).mul(pack?.packageFactor ?? toBase(1, unit)) });
      const { mode } = await resolver.preparation(ingredient);
      recipe = { kind: mode === 'virtual' ? 'virtual' : 'stock', preparationMode: mode };
    } else if (input.kind === 'dish') {
      const current = await tx.dish.findFirst({ where: { id: input.sourceId, cafeId: warehouse.cafeId, ...writeoffDishAvailability(effectiveAt) }, include: { variants: true, recipeItems: true } });
      if (!current || effectiveAt && current.createdAt > effectiveAt) throw new BadRequestException('Техкарта недоступна на дату списания');
      const revision = effectiveAt ? await tx.recipeRevision.findFirst({ where: { dishId: current.id, cafeId: warehouse.cafeId, createdAt: { gt: effectiveAt } },
        orderBy: [{ createdAt: 'asc' }, { version: 'asc' }] }) : null;
      const dish = revision ? writeoffRecipeVersion(current, revision) : current;
      if (dish.isSet) throw new BadRequestException('Техкарта недоступна для списания');
      const variant = input.variantId ? dish.variants.find((entry) => entry.id === input.variantId) : undefined;
      if (input.variantId && !variant) throw new BadRequestException('Вариант не относится к блюду');
      if (dish.variants.length && !variant) throw new BadRequestException('Выберите вариант блюда');
      const defaultUnit = writeoffDishUnit(dish);
      const type = defaultUnit === 'ml' ? 'volume' : defaultUnit === 'g' ? 'mass' : 'count';
      unit = normalizeUnit(input.unit ?? defaultUnit);
      assertUnitMatchesType(unit, type);
      if (pack) assertUnitMatchesType(pack.packageUnit, type);
      const amountBase = new Prisma.Decimal(input.quantity).mul(pack?.packageFactor ?? toBase(1, unit));
      const multiplier = dish.isWeighted
        ? amountBase.div(dish.weightedPriceBase)
        : amountBase;
      name = variant ? `${dish.name} · ${variant.name}` : dish.name;
      const directId = variant?.stockIngredientId ?? dish.stockIngredientId;
      if (directId) roots.push({ ingredientId: directId, amount: (variant?.stockIngredientId ? variant.stockAmount : dish.stockAmount).mul(multiplier) });
      else for (const row of recipeRowsForVariant<{ ingredientId: string; amount: Prisma.Decimal; variantId: string | null; variantAmounts: Prisma.JsonValue }>(dish.recipeItems, variant)) roots.push({
        ingredientId: row.ingredientId, amount: recipeAmount(row, variant?.recipeMetadata == null ? variant?.id : undefined).mul(multiplier),
      });
      recipe = { kind: directId ? 'direct' : 'recipe', dishId: dish.id, recipeVersion: dish.recipeVersion,
        variantId: variant?.id ?? null, weightedPriceBase: Number(dish.weightedPriceBase) };
    } else throw new BadRequestException('Неизвестный тип продукта списания');
    const parts = [];
    for (const root of roots) parts.push(...await resolver.expand(root.ingredientId, root.amount, warehouse,
      { exactStockQuantity: input.kind === 'ingredient' || recipe.kind === 'direct' }));
    const aggregate = new Map<string, { part: typeof parts[number]; amount: Prisma.Decimal }>();
    for (const part of parts) {
      const previous = aggregate.get(part.ingredient.id);
      aggregate.set(part.ingredient.id, { part, amount: (previous?.amount ?? zero).add(part.amount) });
    }
    const sourceParts: SourcePart[] = [...aggregate.values()].map(({ part, amount }) => ({
      ingredientId: part.ingredient.id, name: part.ingredient.name, unit: normalizeUnit(part.ingredient.displayUnit),
      amountBase: amount.toDecimalPlaces(3).toString(),
    })).filter((part) => new Prisma.Decimal(part.amountBase).gt(0)).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
    if (!sourceParts.length) throw new BadRequestException(`Для «${name}» не настроен состав для списания`);
    if (sourceParts.some((part) => new Prisma.Decimal(part.amountBase).gte('100000000000'))) throw new BadRequestException('Количество вне допустимого диапазона');
    recipe = { ...recipe, preparations: [...new Map(parts.flatMap((part) => part.preparations).map((snapshot) => [snapshot.signature, snapshot])).values()] as unknown as Prisma.InputJsonValue };
    const signature = createHash('sha256').update(JSON.stringify({ kind: input.kind, sourceId: input.sourceId,
      variantId: input.variantId ?? null, quantity: input.quantity, unit, ...(pack ? { package: pack } : {}), recipe, parts: sourceParts.map(({ ingredientId, amountBase }) => ({ ingredientId, amountBase })) })).digest('hex');
    if ((requireSignatures && !input.recipeSignature) || (input.recipeSignature && input.recipeSignature !== signature)) {
      throw new ConflictException('Состав изменился. Обновите предварительный расчёт');
    }
    const details = input.details === undefined && previousLine?.kind === input.kind && previousLine.sourceId === input.sourceId &&
      previousLine.variantId === input.variantId ? previousLine.details : input.details?.trim();
    lines.push({ sourceLineId: input.sourceLineId, kind: input.kind, sourceId: input.sourceId, variantId: input.variantId,
      name, quantity: input.quantity, unit, ...pack, ...(details ? { details } : {}), recipeSignature: signature, parts: sourceParts, recipe });
  }
  return { version: 1, lines };
}

export function sourceInputs(snapshot: WriteoffSnapshot): WriteoffSourceLineDto[] {
  return snapshot.lines.map(({ sourceLineId, kind, sourceId, variantId, quantity, unit, recipeSignature, packageId, details }) => ({
    sourceLineId, kind, sourceId, variantId, quantity, unit, recipeSignature, details,
    ...(packageId ? { packageId, packageSnapshotLineId: sourceLineId } : {}),
  }));
}

export async function writeoffStockLines(tx: Prisma.TransactionClient, snapshot: WriteoffSnapshot, saved: Array<{ ingredientId: string; unit: string }> = []) {
  const amounts = new Map<string, Prisma.Decimal>();
  for (const line of snapshot.lines) for (const part of line.parts) amounts.set(part.ingredientId,
    (amounts.get(part.ingredientId) ?? zero).add(part.amountBase));
  const ingredients = await tx.ingredient.findMany({ where: { cafeId: getCafeId(), id: { in: [...amounts.keys()] } } });
  return ingredients.map((ingredient) => ({ ingredientId: ingredient.id,
    quantity: fromBase(Number(amounts.get(ingredient.id)!), normalizeUnit(saved.find((line) => line.ingredientId === ingredient.id)?.unit ?? ingredient.displayUnit)) }));
}

export function serializeWriteoffSources(snapshot: WriteoffSnapshot, costs: Map<string, { cost: Prisma.Decimal | null; stock?: Prisma.Decimal }>) {
  const lines = snapshot.lines.map((line) => {
    const parts = line.parts.map((part) => {
      const value = costs.get(part.ingredientId), amount = new Prisma.Decimal(part.amountBase);
      return { ingredientId: part.ingredientId, name: part.name, unit: unitLabel(part.unit), unitCode: part.unit,
        quantity: fromBase(Number(amount), part.unit), availableQuantity: value?.stock == null ? undefined : fromBase(Number(value.stock), part.unit),
        unitCost: value?.cost == null ? null : costFromBase(Number(value.cost), part.unit),
        total: value?.cost == null ? null : Number(amount.mul(value.cost).toDecimalPlaces(2)) };
    });
    const known = line.parts.every((part) => costs.get(part.ingredientId)?.cost != null);
    const exactTotal = line.parts.reduce((sum, part) => sum.add(new Prisma.Decimal(part.amountBase).mul(costs.get(part.ingredientId)?.cost ?? zero)), zero);
    const { recipe: _recipe, ...display } = line;
    return { ...display, unit: unitLabel(line.unit), unitCode: line.unit,
      physicalQuantity: fromBase(Number(new Prisma.Decimal(line.quantity).mul(line.packageFactor ?? toBase(1, line.unit))), line.unit),
      parts, total: known ? Number(exactTotal.toDecimalPlaces(2)) : null };
  });
  const allParts = snapshot.lines.flatMap((line) => line.parts);
  const total = allParts.every((part) => costs.get(part.ingredientId)?.cost != null)
    ? Number(allParts.reduce((sum, part) => sum.add(new Prisma.Decimal(part.amountBase).mul(costs.get(part.ingredientId)!.cost!)), zero).toDecimalPlaces(2)) : null;
  return { sourceLines: lines, total };
}

export async function previewWriteoffSources(tx: Prisma.TransactionClient, warehouse: WarehouseLocation, snapshot: WriteoffSnapshot) {
  const ids = [...new Set(snapshot.lines.flatMap((line) => line.parts.map((part) => part.ingredientId)))];
  const ingredients = await tx.ingredient.findMany({ where: { cafeId: warehouse.cafeId, id: { in: ids } } });
  const balances = await warehouseBalances(tx, warehouse, ingredients);
  return serializeWriteoffSources(snapshot, new Map([...balances].map(([id, balance]) => [id, {
    stock: balance.stock, cost: balance.valuationKnown ? balance.avgCost : null,
  }])));
}
