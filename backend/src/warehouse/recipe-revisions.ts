import { Prisma } from '@prisma/client';
import type { AuditActor } from '../audit/audit.service';
import { getCafeId } from '../tenant/tenant-context';
import { readProcessingStages } from './recipe-processing';
import { processingBases, processingMethods } from './recipe-processing.dto';
import { fromBase, normalizeUnit, type UnitCode } from './units';

const itemLabelSelect = { id: true, name: true, displayUnit: true } as const;
type ItemLabel = Prisma.IngredientGetPayload<{ select: typeof itemLabelSelect }>;
export type RecipeRevisionEditor = Pick<AuditActor, 'id' | 'name'>;

export async function archiveDishRecipe(tx: Prisma.TransactionClient, dishId: string, editor?: RecipeRevisionEditor,
  variantSnapshot: 'summary' | 'full' = 'summary') {
  const dish = await tx.dish.findUniqueOrThrow({ where: { id: dishId }, include: {
    recipeItems: true,
    variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
    modifierGroups: { include: { options: true } },
    setComponents: { include: { dish: { select: { name: true } }, dishVariant: { select: { name: true } } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  } });
  const ids = [dish.stockIngredientId, ...dish.variants.map((variant) => variant.stockIngredientId),
    ...dish.recipeItems.map((item) => item.ingredientId), ...dish.modifierGroups.flatMap((group) => group.options.map((option) => option.ingredientId))];
  const labels = await ingredientLabels(tx, ids);
  const variants = variantSnapshot === 'full' ? dish.variants : dish.variants.map(({ id, name, stockIngredientId, stockAmount, recipeMetadata }) => ({
    id, name, stockIngredientId, stockAmount, ...(recipeMetadata != null && { recipeMetadata }),
  }));
  await tx.recipeRevision.upsert({
    where: { dishId_version: { dishId, version: dish.recipeVersion } },
    create: { dishId, version: dish.recipeVersion, snapshot: JSON.parse(JSON.stringify({
      replacedBy: editor ? { id: editor.id, name: editor.name ?? null } : null,
      modifierGroups: dish.modifierGroups, allowIngredientExclusions: dish.allowIngredientExclusions,
      excludableIngredientIds: dish.excludableIngredientIds, metadata: dish.recipeMetadata,
      stockIngredientId: dish.stockIngredientId, stockAmount: dish.stockAmount, items: dish.recipeItems, variants,
      ingredientLabels: Object.fromEntries(labels),
      setComponents: dish.setComponents.map(({ dish, dishId, dishVariant, dishVariantId, id, quantity }) => ({
        id, dishId, dishName: dish.name, variantId: dishVariantId, variantName: dishVariant?.name ?? null, quantity,
      })),
    })) },
    update: {},
  });
}

const object = (value: Prisma.JsonValue | undefined): Prisma.JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const records = (value: Prisma.JsonValue | undefined) => Array.isArray(value) ? value.map(object) : [];
const string = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const number = (value: unknown) => {
  if (typeof value !== 'number' && !string(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const enumValue = <T extends string>(value: unknown, values: readonly T[]) => values.find((option) => option === value) ?? null;

function unitCode(value: unknown) {
  if (!string(value)) return null;
  try {
    return normalizeUnit(value as string);
  } catch {
    return null;
  }
}

const quantity = (value: unknown, unit: UnitCode | null) => {
  const base = number(value);
  return base == null || !unit ? base : fromBase(base, unit);
};

async function ingredientLabels(tx: Prisma.TransactionClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => id != null))];
  const labels = unique.length ? await tx.ingredient.findMany({ where: { cafeId: getCafeId(), id: { in: unique } }, select: itemLabelSelect }) : [];
  return new Map(labels.map((label) => [label.id, label]));
}

function composition(snapshot: Prisma.JsonObject, labels: Map<string, ItemLabel>) {
  const savedLabels = object(snapshot.ingredientLabels);
  const ingredient = (id: string) => {
    const saved = object(savedLabels[id]);
    const current = labels.get(id);
    return { ingredientId: id, name: string(saved.name) ?? current?.name ?? null, unit: unitCode(saved.displayUnit ?? current?.displayUnit) };
  };
  const binding = (row: Prisma.JsonObject) => {
    const id = string(row.stockIngredientId);
    if (!id) return null;
    const item = ingredient(id);
    return { ...item, amount: quantity(row.stockAmount, item.unit) };
  };
  const variants = records(snapshot.variants).flatMap((variant) => {
    const id = string(variant.id);
    return id ? [{ id, name: string(variant.name), stockItem: binding(variant) }] : [];
  });
  const variantNames = new Map(variants.map(({ id, name }) => [id, name]));
  const items = records(snapshot.items).flatMap((item) => {
    const id = string(item.ingredientId);
    if (!id) return [];
    const label = ingredient(id);
    const unit = unitCode(item.amountUnit) ?? label.unit;
    const variantId = string(item.variantId);
    const variantAmounts = Object.entries(object(item.variantAmounts)).flatMap(([variantId, value]) => {
      const amount = quantity(value, unit);
      return amount == null ? [] : [{ variantId, name: variantNames.get(variantId) ?? null, amount }];
    });
    return [{ ...label, unit, amount: quantity(item.amount, unit), netAmount: quantity(item.netAmount, unit),
      ...(variantId && { variantId, variantName: variantNames.get(variantId) ?? null }),
      measuredNetWeightGrams: number(item.measuredNetWeightGrams), lossPercent: number(item.lossPercent),
      processingMethod: enumValue(item.processingMethod, processingMethods), processingBasis: enumValue(item.processingBasis, processingBases),
      processingStages: readProcessingStages(item.processingStages), variantAmounts }];
  });
  const components = Array.isArray(snapshot.setComponents) ? records(snapshot.setComponents).flatMap((row) => {
    const id = string(row.id);
    const dishId = string(row.dishId);
    return id && dishId ? [{ id, dishId, name: string(row.dishName), variantId: string(row.variantId),
      variantName: string(row.variantName), quantity: number(row.quantity) }] : [];
  }) : null;
  const modifierGroups = records(snapshot.modifierGroups).flatMap((group) => {
    const id = string(group.id);
    const name = string(group.name);
    if (!id || !name) return [];
    const options = records(group.options).flatMap((option) => {
      const id = string(option.id);
      const name = string(option.name);
      if (!id || !name) return [];
      const ingredientId = string(option.ingredientId);
      const item = ingredientId ? ingredient(ingredientId) : null;
      const unit = unitCode(option.amountUnit) ?? item?.unit ?? null;
      return [{ id, name, ingredient: item ? { ...item, unit, amount: quantity(option.amount, unit) } : null }];
    });
    return [{ id, name, options }];
  });
  const metadata = object(snapshot.metadata);
  const outputAmount = number(metadata.outputQuantity);
  return { items, variants, stockItem: binding(snapshot), components, modifierGroups, instructions: string(metadata.instructions),
    output: outputAmount == null ? null : { amount: outputAmount, unit: string(metadata.outputUnit) } };
}

export async function readCompositionRevisions(tx: Prisma.TransactionClient, dishId: string) {
  const revisions = await tx.recipeRevision.findMany({ where: { dishId }, orderBy: { version: 'desc' }, take: 101,
    select: { id: true, version: true, createdAt: true, snapshot: true } });
  const rows = revisions.slice(0, 100);
  const snapshots = rows.map(({ snapshot }) => object(snapshot));
  const ids = snapshots.flatMap((snapshot) => {
    const saved = object(snapshot.ingredientLabels);
    return [string(snapshot.stockIngredientId), ...records(snapshot.variants).map((variant) => string(variant.stockIngredientId)),
      ...records(snapshot.items).map((item) => string(item.ingredientId)),
      ...records(snapshot.modifierGroups).flatMap((group) => records(group.options).map((option) => string(option.ingredientId))),
    ].filter((id) => id && !string(object(saved[id]).name));
  });
  const labels = await ingredientLabels(tx, ids);
  return rows.map((row, index) => {
    const previous = revisions[index + 1];
    const adjacent = previous?.version === row.version - 1 ? previous : null;
    return { id: row.id, version: row.version, replacedAt: row.createdAt,
      replacedBy: string(object(snapshots[index].replacedBy).name),
      savedAt: adjacent?.createdAt ?? null,
      savedBy: adjacent ? string(object(object(adjacent.snapshot).replacedBy).name) : null,
      ...composition(snapshots[index], labels) };
  });
}
