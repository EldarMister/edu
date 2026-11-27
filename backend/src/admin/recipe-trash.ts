import { BadRequestException } from '@nestjs/common';
import { Prisma, type Dish } from '@prisma/client';

const restoreDays = 30;
export const earliestRestorableDate = () => new Date(Date.now() - restoreDays * 86_400_000);
type Candidate = Pick<Dish, 'id' | 'isSet' | 'catalogKind' | 'archivedAt'>;

/** Caller holds the exclusive recipe graph lock, also taken in shared mode when placing orders. */
export async function archiveRecipes(tx: Prisma.TransactionClient, dishes: Candidate[], removedSets: string[] = []) {
  const ids = dishes.filter((dish) => !dish.isSet && dish.catalogKind === 'recipe' && !dish.archivedAt).map((dish) => dish.id);
  return archiveMenuItems(tx, ids, { removedSets });
}

export async function archiveMenuItems(tx: Prisma.TransactionClient, ids: string[], {
  removedSets = [], archivedAt = new Date(), categoryId = null,
}: { removedSets?: string[]; archivedAt?: Date; categoryId?: string | null } = {}) {
  if (!ids.length) return;
  const set = await tx.setComponent.findFirst({ where: { dishId: { in: ids }, setId: { notIn: removedSets }, set: { archivedAt: null } },
    select: { set: { select: { name: true } }, dish: { select: { name: true } } } });
  if (set) throw new BadRequestException(`«${set.dish.name}» входит в сет «${set.set.name}». Сначала уберите эту позицию из состава сета.`);
  const open = await tx.orderItem.findFirst({ where: { order: { status: { notIn: ['paid', 'cancelled', 'rejected'] } },
    status: { notIn: ['cancelled', 'rejected'] }, OR: [{ dishId: { in: ids } },
      { setComponents: { some: { OR: [{ originalDishId: { in: ids } }, { finalDishId: { in: ids } }] } } }] }, select: { id: true } });
  if (open) throw new BadRequestException('Позиция меню используется в открытом заказе. Завершите его перед удалением.');
  for (const active of [false, true]) {
    await tx.dish.updateMany({
      where: { id: { in: ids }, isActive: active, archivedAt: null },
      data: { archivedAt, activeBeforeArchive: active, isActive: false, archivedWithCategoryId: categoryId },
    });
  }
}
