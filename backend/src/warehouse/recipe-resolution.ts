import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { createHash } from 'node:crypto';
import { processingSnapshot } from './recipe-processing';

type PreparationSnapshot = {
  ingredientId: string; outputAmount: string; outputUnit: string; signature: string; instructions: string | null;
  items: ({ ingredientId: string; amount: string; unit: string; netAmount: string | null; lossPercent: string; processingMethod: string | null }
    & ReturnType<typeof processingSnapshot>)[];
};

export type ResolvedRecipePart = {
  ingredient: Prisma.IngredientGetPayload<{}>;
  amount: Prisma.Decimal;
  warehouse: Pick<Prisma.WarehouseGetPayload<{}>, 'id' | 'name' | 'cafeId' | 'isDefault'> | null;
  path: string[];
  preparations: PreparationSnapshot[];
};

type StoredPreparation = {
  mode: string;
  recipe: Omit<PreparationSnapshot, 'signature'> | null;
};

async function currentPreparation(tx: Prisma.TransactionClient, ingredient: { id: string; isPrepared: boolean; preparationMode: string }): Promise<StoredPreparation> {
  const mode = ingredient.isPrepared ? ingredient.preparationMode : 'stocked';
  const recipe = mode === 'virtual' ? await tx.preparationRecipe.findUnique({ where: { ingredientId: ingredient.id }, include: { items: true } }) : null;
  return { mode, recipe: recipe ? { ingredientId: ingredient.id, outputAmount: recipe.outputAmount.toString(), outputUnit: recipe.outputUnit, instructions: recipe.instructions,
    items: recipe.items.map((item) => ({ ingredientId: item.ingredientId, amount: item.amount.toString(), unit: item.unit,
      netAmount: item.netAmount?.toString() ?? null, lossPercent: item.lossPercent.toString(), processingMethod: item.processingMethod,
      ...processingSnapshot(item) })).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId)) } : null };
}

export async function archivePreparation(tx: Prisma.TransactionClient, ingredient: { id: string; isPrepared: boolean; preparationMode: string; cafeId: string | null }) {
  if (!ingredient.cafeId) return;
  const previous = await currentPreparation(tx, ingredient);
  // Preserve field order for signatures issued before this edit (jsonb normalizes object keys).
  await tx.preparationRecipeRevision.create({ data: { cafeId: ingredient.cafeId, ingredientId: ingredient.id, replacedAt: new Date(), snapshot: JSON.stringify(previous) } });
}

/** Shared expansion for costing and actual consumption. A stocked preparation is always a leaf. */
export class RecipeResolver {
  private ingredients = new Map<string, Prisma.IngredientGetPayload<{}>>();
  private recipes = new Map<string, StoredPreparation>();
  constructor(private tx: Prisma.TransactionClient, private options: { allowInactive?: boolean; effectiveAt?: Date | null } = {}) {}

  async preparation(ingredient: Prisma.IngredientGetPayload<{}>) {
    const cached = this.recipes.get(ingredient.id);
    if (cached) return cached;
    const date = this.options.effectiveAt;
    const revision = date ? await this.tx.preparationRecipeRevision.findFirst({
      where: { cafeId: getCafeId(), ingredientId: ingredient.id, replacedAt: { gt: date } }, orderBy: [{ replacedAt: 'asc' }, { id: 'asc' }],
    }) : null;
    if (revision && revision.snapshot === null) throw new BadRequestException(`Состав заготовки «${ingredient.name}» на выбранную дату не сохранён. Укажите известные ингредиенты отдельно.`);
    const state: StoredPreparation = revision?.snapshot ? JSON.parse(revision.snapshot) : await currentPreparation(this.tx, ingredient);
    this.recipes.set(ingredient.id, state);
    return state;
  }

  async expand(ingredientId: string, amount: Prisma.Decimal, warehouse: Pick<Prisma.WarehouseGetPayload<{}>, 'id' | 'name' | 'cafeId' | 'isDefault'> | null, path: string[] = [], preparations: PreparationSnapshot[] = []): Promise<ResolvedRecipePart[]> {
    if (path.includes(ingredientId)) throw new BadRequestException('Циклическая зависимость в рецептуре полуфабриката');
    if (path.length >= 32) throw new BadRequestException('Слишком много уровней в рецептуре');
    if (amount.lte(0)) return [];
    let ingredient = this.ingredients.get(ingredientId);
    if (!ingredient) {
      ingredient = await this.tx.ingredient.findFirst({ where: { id: ingredientId, cafeId: getCafeId(), ...(this.options.allowInactive ? {} : { isActive: true }) } }) ?? undefined;
      if (!ingredient) throw new BadRequestException('Ингредиент рецептуры недоступен');
      this.ingredients.set(ingredientId, ingredient);
    }
    const nextPath = [...path, ingredientId];
    const { mode, recipe: recipeSnapshot } = await this.preparation(ingredient);
    if (mode !== 'virtual') {
      return [{ ingredient, amount, warehouse, path: nextPath, preparations }];
    }
    if (!recipeSnapshot?.items.length || !new Prisma.Decimal(recipeSnapshot.outputAmount).gt(0)) throw new BadRequestException(`Не настроена рецептура заготовки «${ingredient.name}»`);
    const parts: ResolvedRecipePart[] = [];
    const signature = createHash('sha256').update(JSON.stringify(recipeSnapshot)).digest('hex');
    const snapshot = { ...recipeSnapshot, signature };
    for (const item of recipeSnapshot.items) parts.push(...await this.expand(item.ingredientId, amount.mul(item.amount).div(recipeSnapshot.outputAmount), warehouse, nextPath, [...preparations, snapshot]));
    return parts;
  }
}

export function recipeAmount(row: { amount: Prisma.Decimal; variantAmounts: Prisma.JsonValue | null }, variantId?: string | null): Prisma.Decimal {
  const amounts = row.variantAmounts;
  if (variantId && amounts && typeof amounts === 'object' && !Array.isArray(amounts) && amounts[variantId] !== undefined) {
    const saved = amounts[variantId];
    if (!(typeof saved === 'number' || typeof saved === 'string' && saved.trim()) || !Number.isFinite(Number(saved))) {
      throw new BadRequestException('Некорректная норма варианта блюда');
    }
    const amount = new Prisma.Decimal(saved);
    if (!amount.isFinite() || amount.lt(0)) throw new BadRequestException('Некорректная норма варианта блюда');
    return amount;
  }
  return row.amount;
}

export function recipeRowsForVariant<T extends { variantId?: string | null }>(
  rows: readonly T[], variant?: { id: string; recipeMetadata?: Prisma.JsonValue } | null,
): T[] {
  const recipeVariantId = variant?.recipeMetadata != null ? variant.id : null;
  return rows.filter((row) => (row.variantId ?? null) === recipeVariantId);
}

export function warehouseKey(warehouse: { id: string; isDefault: boolean } | null | undefined) {
  return warehouse && !warehouse.isDefault ? warehouse.id : 'default';
}

/** All recipe mutations in a cafe share this lock; concurrent edits cannot introduce a cycle. */
export async function lockRecipeGraph(tx: Prisma.TransactionClient, shared = false) {
  const key = `warehouse-recipes:${getCafeId() ?? 'legacy'}`;
  if (shared) {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock_shared(hashtext(${key}))) AS recipe_graph_lock`;
    return;
  }
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS recipe_graph_lock`;
}
