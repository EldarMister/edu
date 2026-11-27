import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Category, Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { ensureMainMenuCategory, MAIN_SCREEN } from './main-menu-category';
import { updateInheritedTaxes } from './menu-category-tax';
import { archiveMenuItems, earliestRestorableDate } from './recipe-trash';

function collectSubtree(rootId: string, categories: { id: string; parentId: string | null }[]) {
  const children = new Map<string, string[]>();
  for (const { id, parentId } of categories) {
    if (!parentId) continue;
    const branch = children.get(parentId);
    if (branch) branch.push(id);
    else children.set(parentId, [id]);
  }
  const ids = new Set([rootId]);
  for (const parent of ids) {
    for (const child of children.get(parent) ?? []) ids.add(child);
  }
  return [...ids];
}

/** Category deletion/restoration holds both the recipe graph and station routing locks. */
export async function archiveCategory(tx: Prisma.TransactionClient, root: Pick<Category, 'id' | 'parentId' | 'taxId'>, moveToId?: string) {
  const cafeId = getCafeId() ?? null;
  let ids: string[];
  let dishCount: number;
  const archivedAt = new Date();
  if (moveToId) {
    const target = moveToId === MAIN_SCREEN
      ? await ensureMainMenuCategory(tx)
      : moveToId !== root.id && await tx.category.findUnique({
        where: { id: moveToId, cafeId, archivedAt: null }, select: { id: true },
      });
    if (!target) throw new BadRequestException('Выберите категорию, в которую перенести позиции');
    const moved = await tx.dish.updateMany({
      where: { cafeId, categoryId: root.id, archivedAt: null }, data: { categoryId: target.id },
    });
    dishCount = moved.count;
    const parent = root.parentId ? await tx.category.findUnique({ where: { id: root.parentId, cafeId }, select: { taxId: true } }) : null;
    if (root.taxId !== (parent?.taxId ?? null)) await updateInheritedTaxes(tx, root.id, parent?.taxId ?? null);
    // Archived children retain their original parent for a future independent restore.
    await tx.category.updateMany({
      where: { cafeId, parentId: root.id, archivedAt: null }, data: { parentId: root.parentId },
    });
    ids = [root.id];
  } else {
    const categories = await tx.category.findMany({
      where: { cafeId, archivedAt: null }, select: { id: true, parentId: true },
    });
    ids = collectSubtree(root.id, categories);
    const dishes = await tx.dish.findMany({
      where: { cafeId, categoryId: { in: ids }, archivedAt: null }, select: { id: true, isSet: true },
    });
    dishCount = dishes.length;
    await archiveMenuItems(tx, dishes.map(({ id }) => id), {
      archivedAt, categoryId: root.id, removedSets: dishes.filter(({ isSet }) => isSet).map(({ id }) => id),
    });
  }

  for (const active of [false, true]) {
    await tx.category.updateMany({
      where: { cafeId, id: { in: ids }, archivedAt: null, isActive: active },
      data: { isActive: false, activeBeforeArchive: active, archivedAt, archiveRootId: root.id },
    });
  }
  return dishCount;
}

export async function restoreCategoryGroup(tx: Prisma.TransactionClient, id: string) {
  const cafeId = getCafeId() ?? null;
  const root = await tx.category.findUnique({
    where: { id, cafeId, archiveRootId: id, archivedAt: { gt: earliestRestorableDate() } },
    select: { id: true, name: true, parentId: true, inheritTax: true },
  });
  if (!root) throw new NotFoundException('Категория отсутствует в корзине или срок восстановления истёк');
  const parent = root.parentId ? await tx.category.findUnique({
    where: { id: root.parentId, cafeId }, select: { id: true, archivedAt: true, archiveRootId: true, name: true, taxId: true },
  }) : null;
  if (parent?.archivedAt) {
    const archiveRoot = parent.archiveRootId && parent.archiveRootId !== parent.id ? await tx.category.findUnique({
      where: { id: parent.archiveRootId, cafeId }, select: { name: true },
    }) : null;
    throw new BadRequestException(`Сначала восстановите родительскую категорию «${archiveRoot?.name ?? parent.name}»`);
  }
  if (root.parentId && !parent) throw new BadRequestException('Родительская категория не найдена');
  const dependency = await tx.setComponent.findFirst({
    where: { cafeId, set: { archivedWithCategoryId: id },
      dish: { archivedAt: { not: null }, OR: [{ archivedWithCategoryId: null }, { archivedWithCategoryId: { not: id } }] } },
    select: { set: { select: { name: true } }, dish: { select: { name: true, archivedWithCategoryId: true } } },
  });
  if (dependency) {
    const archiveRoot = dependency.dish.archivedWithCategoryId ? await tx.category.findUnique({
      where: { id: dependency.dish.archivedWithCategoryId, cafeId }, select: { name: true },
    }) : null;
    const recover = archiveRoot ? `категорию «${archiveRoot.name}»` : `позицию «${dependency.dish.name}»`;
    throw new BadRequestException(`Сет «${dependency.set.name}» использует позицию «${dependency.dish.name}» из корзины. Сначала восстановите ${recover}.`);
  }

  for (const active of [false, true]) {
    await tx.category.updateMany({
      where: { cafeId, archiveRootId: id, archivedAt: { not: null }, activeBeforeArchive: active },
      data: { isActive: active, activeBeforeArchive: null, archivedAt: null, archiveRootId: null },
    });
    await tx.dish.updateMany({
      where: { cafeId, archivedWithCategoryId: id, archivedAt: { not: null }, activeBeforeArchive: active },
      data: { isActive: active, activeBeforeArchive: null, archivedAt: null, archivedWithCategoryId: null },
    });
  }
  if (root.inheritTax) {
    const taxId = parent?.taxId ?? null;
    await tx.category.update({ where: { id, cafeId }, data: { taxId } });
    await updateInheritedTaxes(tx, id, taxId);
  }
  return { id, name: root.name };
}

export async function listTrashedCategories(tx: Prisma.TransactionClient) {
  const cafeId = getCafeId() ?? null;
  const categories = await tx.category.findMany({
    where: { cafeId, archivedAt: { gt: earliestRestorableDate() } },
    select: { id: true, name: true, archivedAt: true, archiveRootId: true,
      parent: { select: { name: true, archivedAt: true, archiveRootId: true } } },
    orderBy: [{ archivedAt: 'desc' }, { id: 'asc' }],
  });
  const roots = categories.filter(({ id, archiveRootId }) => id === archiveRootId);
  if (!roots.length) return [];
  const items = await tx.dish.groupBy({
    by: ['archivedWithCategoryId'], where: { cafeId, archivedWithCategoryId: { in: roots.map(({ id }) => id) } },
    _count: { _all: true },
  });
  const counts = new Map(items.map(({ archivedWithCategoryId, _count }) => [archivedWithCategoryId, _count._all]));
  const rootNames = new Map(roots.map(({ id, name }) => [id, name]));
  return roots.map(({ id, name, archivedAt, parent }) => ({
    id, name, archivedAt: archivedAt!.toISOString(), itemCount: counts.get(id) ?? 0,
    parentInTrash: parent?.archivedAt ? rootNames.get(parent.archiveRootId ?? '') ?? parent.name : null,
  }));
}
