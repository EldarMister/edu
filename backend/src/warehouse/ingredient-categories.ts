import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients } from './stock-lock';
import { warehouseBalances } from './warehouse-location';

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

export async function listIngredientCategoriesWithStock(db: Prisma.TransactionClient) {
  const scope = categoryScope();
  const [categories, ingredients] = await Promise.all([
    listIngredientCategories(db),
    db.ingredient.findMany({
      where: { ...scope, isActive: true, category: { not: null } },
      select: { id: true, category: true, unitType: true, stock: true, avgCost: true, valuationKnown: true },
    }),
  ]);
  const balances = await warehouseBalances(db, null, ingredients);
  const totals = new Map(categories.map(({ name }) => [name, {
    stock: { mass: new Prisma.Decimal(0), volume: new Prisma.Decimal(0), count: new Prisma.Decimal(0) },
    value: new Prisma.Decimal(0),
    complete: true,
  }]));
  for (const { id, category, unitType } of ingredients) {
    const total = category == null ? undefined : totals.get(category);
    if (!total) continue;
    const balance = balances.get(id)!;
    total.stock[unitType] = total.stock[unitType].add(balance.stock);
    total.value = total.value.add(balance.knownStockValue);
    total.complete &&= balance.stockValueKnown;
  }
  return categories.map((category) => {
    const total = totals.get(category.name)!;
    return {
      ...category,
      stockByUnit: { kg: total.stock.mass.div(1000).toNumber(), l: total.stock.volume.div(1000).toNumber(), pcs: total.stock.count.toNumber() },
      stockValue: total.complete ? total.value.toNumber() : null,
    };
  });
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

export function activeIngredientCategoryMembers(db: Prisma.TransactionClient, name: string) {
  return db.ingredient.findMany({
    where: { ...categoryScope(), category: name, isActive: true },
    select: { id: true },
  });
}

export async function removeIngredientCategory(db: Prisma.TransactionClient, name: string) {
  const scope = categoryScope();
  await updateIngredientCategory(db, { ...scope, category: name }, null);
  await db.ingredientCategory.deleteMany({ where: { cafeId: scope.cafeId, name } });
  return { ok: true };
}

async function updateIngredientCategory(db: Prisma.TransactionClient, where: Prisma.IngredientWhereInput, category: string | null) {
  const ingredients = await db.ingredient.findMany({ where, select: { id: true } });
  await lockIngredients(db, ingredients.map(({ id }) => id));
  await db.ingredient.updateMany({ where, data: { category } });
}
