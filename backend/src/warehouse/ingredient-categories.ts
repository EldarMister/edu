import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients } from './stock-lock';

const ingredientScope = { isPrepared: false, kind: { in: ['raw', 'consumable'] } } satisfies Prisma.IngredientWhereInput;

export async function lockIngredientCategories(db: Prisma.TransactionClient) {
  const cafeId = getCafeId();
  if (cafeId) await db.$queryRaw`SELECT 1 FROM (
    SELECT pg_advisory_xact_lock(hashtext(${`ingredient-categories:${cafeId}`}))
  ) AS category_lock`;
}

export async function registerIngredientCategories(db: Prisma.TransactionClient, names: (string | null | undefined)[]) {
  const cafeId = getCafeId();
  const categories = [...new Set(names.filter((name): name is string => !!name))];
  if (cafeId && categories.length) {
    await db.ingredientCategory.createMany({ data: categories.map((name) => ({ cafeId, name })), skipDuplicates: true });
  }
}

function categoryScope() {
  const cafeId = getCafeId();
  if (!cafeId) throw new BadRequestException('Кафе не выбрано');
  return { cafeId, ...ingredientScope };
}

export async function listIngredientCategories(db: Prisma.TransactionClient) {
  const scope = categoryScope();
  const [saved, assigned] = await Promise.all([
    db.ingredientCategory.findMany({ where: { cafeId: scope.cafeId }, select: { name: true } }),
    db.ingredient.groupBy({ by: ['category', 'isActive'], where: { ...scope, category: { not: null } }, _count: { _all: true } }),
  ]);
  const categories = new Map(saved.map(({ name }) => [name, 0]));
  for (const { category, isActive, _count } of assigned) {
    if (category) categories.set(category, (categories.get(category) ?? 0) + (isActive ? _count._all : 0));
  }
  return Array.from(categories, ([name, count]) => ({ name, count }));
}

export async function saveIngredientCategory(db: Prisma.TransactionClient, input: string, from?: string) {
  const name = input.trim();
  if (!name) throw new BadRequestException('Укажите название категории');
  const scope = categoryScope();
  await lockIngredientCategories(db);
  const categories = await listIngredientCategories(db);
  const current = categories.find((category) => category.name === from);
  if (from !== undefined && !current) throw new NotFoundException('Категория не найдена');
  if (name !== from && categories.some((category) => category.name === name)) {
    throw new ConflictException('Категория с таким названием уже существует');
  }
  await registerIngredientCategories(db, [name]);
  if (from !== undefined && from !== name) {
    await updateIngredientCategory(db, { ...scope, category: from }, name);
    await db.ingredientCategory.deleteMany({ where: { cafeId: scope.cafeId, name: from } });
  }
  return { name, count: current?.count ?? 0 };
}

export async function removeIngredientCategory(db: Prisma.TransactionClient, name: string) {
  const scope = categoryScope();
  await lockIngredientCategories(db);
  await updateIngredientCategory(db, { ...scope, category: name }, null);
  await db.ingredientCategory.deleteMany({ where: { cafeId: scope.cafeId, name } });
  return { ok: true };
}

async function updateIngredientCategory(db: Prisma.TransactionClient, where: Prisma.IngredientWhereInput, category: string | null) {
  const ingredients = await db.ingredient.findMany({ where, select: { id: true } });
  await lockIngredients(db, ingredients.map(({ id }) => id));
  await db.ingredient.updateMany({ where, data: { category } });
}
