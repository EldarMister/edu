import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';

export const MAIN_SCREEN = '__main_screen__';

export function mainMenuCategoryId() {
  return 'menu-root:' + (getCafeId() ?? 'legacy');
}

export function ensureMainMenuCategory(tx: Prisma.TransactionClient) {
  const id = mainMenuCategoryId();
  return tx.category.upsert({
    where: { id },
    create: { id, name: 'Главный экран', sortOrder: -1, prepStation: 'none' },
    update: {},
  });
}
