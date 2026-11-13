import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { createHash } from 'node:crypto';

type PreparationSnapshot = {
  ingredientId: string; outputAmount: string; outputUnit: string; signature: string; instructions: string | null;
  items: { ingredientId: string; amount: string; unit: string; netAmount: string | null; lossPercent: string; processingMethod: string | null }[];
};

export type ResolvedRecipePart = {
  ingredient: Prisma.IngredientGetPayload<{}>;
  amount: Prisma.Decimal;
  warehouse: Pick<Prisma.WarehouseGetPayload<{}>, 'id' | 'name' | 'cafeId' | 'isDefault'> | null;
  path: string[];
  preparations: PreparationSnapshot[];
};

/** Shared expansion for costing and actual consumption. A stocked preparation is always a leaf. */
export class RecipeResolver {
  private ingredients = new Map<string, Prisma.IngredientGetPayload<{}>>();
  private recipes = new Map<string, Prisma.PreparationRecipeGetPayload<{ include: { items: true } }> | null>();
  constructor(private tx: Prisma.TransactionClient, private options: { allowInactive?: boolean } = {}) {}

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
    if (!ingredient.isPrepared || ingredient.preparationMode !== 'virtual') {
      return [{ ingredient, amount, warehouse, path: nextPath, preparations }];
    }
    if (!this.recipes.has(ingredientId)) this.recipes.set(ingredientId, await this.tx.preparationRecipe.findUnique({ where: { ingredientId }, include: { items: true } }));
    const recipe = this.recipes.get(ingredientId);
    if (!recipe?.items.length || recipe.outputAmount.lte(0)) throw new BadRequestException(`Не настроена рецептура заготовки «${ingredient.name}»`);
    const parts: ResolvedRecipePart[] = [];
    const recipeSnapshot = { ingredientId, outputAmount: recipe.outputAmount.toString(), outputUnit: recipe.outputUnit, instructions: recipe.instructions,
      items: recipe.items.map((item) => ({ ingredientId: item.ingredientId, amount: item.amount.toString(), unit: item.unit, netAmount: item.netAmount?.toString() ?? null, lossPercent: item.lossPercent.toString(), processingMethod: item.processingMethod })).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId)) };
    const signature = createHash('sha256').update(JSON.stringify(recipeSnapshot)).digest('hex');
    const snapshot = { ...recipeSnapshot, signature };
    for (const item of recipe.items) parts.push(...await this.expand(item.ingredientId, item.amount.mul(amount).div(recipe.outputAmount), warehouse, nextPath, [...preparations, snapshot]));
    return parts;
  }
}

export function recipeAmount(row: { amount: Prisma.Decimal; variantAmounts: Prisma.JsonValue | null }, variantId?: string | null): Prisma.Decimal {
  const amounts = row.variantAmounts;
  if (variantId && amounts && typeof amounts === 'object' && !Array.isArray(amounts) && amounts[variantId] !== undefined) {
    const amount = new Prisma.Decimal(String(amounts[variantId]));
    if (!amount.isFinite() || amount.lt(0)) throw new BadRequestException('Некорректная норма варианта блюда');
    return amount;
  }
  return row.amount;
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
