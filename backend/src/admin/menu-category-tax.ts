import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { assertMenuTax } from '../settings/order-taxes';
import { MAIN_SCREEN, mainMenuCategoryId } from './main-menu-category';
import type { CreateCategoryDto } from './dto';

type CategoryState = { id: string; parentId: string | null; taxId: string | null; inheritTax: boolean };
type CategorySettings = Pick<CreateCategoryDto, 'parentId' | 'taxId' | 'taxMode'>;
export function categoryTaxMode(c: Pick<CategoryState, 'taxId' | 'inheritTax'>) {
  return c.inheritTax ? 'inherit' : c.taxId ? 'explicit' : 'none';
}

/** Category writes take the station routing lock, so a concurrent move cannot create a cycle. */
export async function categorySettings(tx: Prisma.TransactionClient, input: CategorySettings, current?: CategoryState) {
  if (current && input.parentId === undefined && input.taxId === undefined && input.taxMode === undefined) return {};
  const requested = input.parentId === undefined ? current?.parentId ?? null : input.parentId;
  const parentId = requested === MAIN_SCREEN || requested === mainMenuCategoryId() ? null : requested;
  let parentTax: string | null = null;
  if (parentId !== null) {
    const nodes = await tx.category.findMany({ where: { cafeId: getCafeId() ?? null, archivedAt: null }, select: { id: true, parentId: true, taxId: true } });
    const byId = new Map(nodes.map((c) => [c.id, c]));
    const parent = byId.get(parentId);
    if (!parent) throw new BadRequestException('Родительская категория не найдена');
    parentTax = parent.taxId;
    const visited = new Set(current ? [current.id] : []);
    for (let node: typeof parent | undefined = parent; node; node = node.parentId ? byId.get(node.parentId) : undefined) {
      if (visited.has(node.id)) throw new BadRequestException('Нельзя поместить категорию в саму себя или в её подкатегорию');
      visited.add(node.id);
    }
  }
  const mode = input.taxMode ?? (input.taxId !== undefined ? input.taxId ? 'explicit' : 'none' : current ? categoryTaxMode(current) : parentId ? 'inherit' : 'none');
  if (mode === 'explicit') {
    const taxId = input.taxId === undefined && current && categoryTaxMode(current) === 'explicit' ? current.taxId : input.taxId;
    if (!taxId) throw new BadRequestException('Выберите налог для категории');
    await assertMenuTax(tx, taxId);
    return { parentId, inheritTax: false, taxId };
  }
  if (input.taxId) throw new BadRequestException('Выберите один режим налога для категории');
  return { parentId, inheritTax: mode === 'inherit', taxId: mode === 'inherit' ? parentTax : null };
}

/** taxId is the effective FK used by receipts, previews and reports. Explicit child overrides stop inheritance. */
export async function updateInheritedTaxes(tx: Prisma.TransactionClient, parentId: string, effectiveTaxId: string | null) {
  const cafeId = getCafeId() ?? null;
  await tx.$executeRaw`WITH RECURSIVE inheriting(id) AS (
    SELECT id FROM categories WHERE cafe_id IS NOT DISTINCT FROM ${cafeId} AND parent_id = ${parentId} AND inherit_tax
    UNION
    SELECT c.id FROM categories c JOIN inheriting p ON c.parent_id = p.id
    WHERE c.cafe_id IS NOT DISTINCT FROM ${cafeId} AND c.inherit_tax
  )
  UPDATE categories SET tax_id = ${effectiveTaxId}, updated_at = CURRENT_TIMESTAMP
  WHERE id IN (SELECT id FROM inheriting) AND tax_id IS DISTINCT FROM ${effectiveTaxId}`;
}
