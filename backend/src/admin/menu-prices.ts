import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { lockStationRouting } from '../kitchen/preparation-stations';
import type { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { lockRecipeGraph } from '../warehouse/recipe-resolution';
import { archiveDishRecipe } from '../warehouse/recipe-revisions';
import type { MenuPriceBatchDto, MenuPriceChangeDto } from './menu-prices.dto';

type Actor = Pick<AuthUser, 'id' | 'name' | 'role' | 'identityRole' | 'cafeId'>;

const selectPriceState = {
  id: true, name: true, price: true, isSet: true, isWeighted: true,
  weightedMeasure: true, weightedPriceBase: true,
  variants: { select: { id: true, name: true, price: true } },
} satisfies Prisma.DishSelect;

type PriceState = Prisma.DishGetPayload<{ select: typeof selectPriceState }>;

export async function saveMenuPrices(prisma: PrismaService, dto: MenuPriceBatchDto, actor: Actor) {
  const cafeId = actor.cafeId;
  if (!cafeId || getCafeId() !== cafeId) throw new ForbiddenException('Заведение не назначено');
  const changesByDish = new Map<string, Map<string | null, MenuPriceChangeDto>>();
  const prices = dto.changes.map((change) => {
    const { dishId, price } = change;
    const variantId = change.variantId ?? null;
    const targets = changesByDish.get(dishId) ?? new Map<string | null, MenuPriceChangeDto>();
    if (targets.has(variantId)) throw new BadRequestException('Цена одной позиции указана дважды');
    targets.set(variantId, change);
    changesByDish.set(dishId, targets);
    return { dishId, variantId, price };
  });
  const dishIds = [...changesByDish.keys()].sort();

  return prisma.$transaction(async (tx) => {
    // These are the same locks used by the menu editor, in the same order.
    await lockRecipeGraph(tx);
    await lockStationRouting(tx, cafeId);
    await tx.$queryRaw`SELECT id FROM dishes
      WHERE cafe_id = ${cafeId} AND id IN (${Prisma.join(dishIds)}) ORDER BY id FOR UPDATE`;
    const dishes = await tx.dish.findMany({
      where: { cafeId, isActive: true, id: { in: dishIds } },
      select: { ...selectPriceState, variants: { ...selectPriceState.variants, where: { cafeId } } },
      orderBy: { id: 'asc' },
    });
    if (dishes.length !== dishIds.length) throw new ConflictException('Позиция меню недоступна. Обновите отчёт.');

    const audit: Prisma.AuditLogCreateManyInput[] = [];
    const changedDishIds: string[] = [];
    for (const dish of dishes) {
      const targets = changesByDish.get(dish.id)!;
      const changes = [...targets].flatMap(([variantId, change]) => {
        const variant = targetVariant(dish, variantId);
        const oldPrice = variant?.price ?? dish.price;
        const unit = !dish.isWeighted ? 'pcs' : dish.weightedMeasure === 'volume' ? 'ml' : 'g';
        const base = dish.isWeighted ? dish.weightedPriceBase : 1;
        const label = variant ? `${dish.name} · ${variant.name}` : dish.name;
        if (base !== change.expectedPriceBase || unit !== change.expectedUnit)
          throw new ConflictException(`Изменилась единица цены «${label}». Обновите отчёт.`);
        if ((variant || dish.isSet) && change.price < 0.01)
          throw new BadRequestException(`Цена «${label}» должна быть больше нуля`);
        // The same request can be repeated safely if the desired price is already in the menu.
        if (oldPrice.eq(change.price)) return [];
        if (!oldPrice.eq(change.expectedPrice)) throw new ConflictException(`Цена «${label}» уже изменилась. Обновите отчёт.`);
        return [{ variant, oldPrice, price: new Prisma.Decimal(change.price), label }];
      });
      if (!changes.length) continue;

      await archiveDishRecipe(tx, dish.id, actor);
      const variantPrices = new Map(dish.variants.map(({ id, price }) => [id, price]));
      let basePrice = dish.price;
      for (const { variant, oldPrice, price, label } of changes) {
        if (variant) {
          await tx.dishVariant.update({ where: { id: variant.id, cafeId, dishId: dish.id }, data: { price } });
          variantPrices.set(variant.id, price);
        } else {
          basePrice = price;
        }
        audit.push({
          cafeId, userId: actor.id, userName: actor.name, userRole: actor.identityRole ?? actor.role,
          actionType: AuditAction.MENU_ITEM_PRICE_CHANGED, entityType: AuditEntity.MENU_ITEM, entityId: dish.id,
          description: `${actor.name} изменил цену «${label}» с ${oldPrice} с на ${price} с`,
          oldValue: { price: oldPrice.toNumber() }, newValue: { price: price.toNumber() },
          metadata: { source: 'food_cost', dishName: dish.name, variantId: variant?.id ?? null, variantName: variant?.name ?? null },
        });
      }
      if (!dish.isWeighted && variantPrices.size) basePrice = Prisma.Decimal.min(...variantPrices.values());
      await tx.dish.update({ where: { id: dish.id, cafeId }, data: { price: basePrice, recipeVersion: { increment: 1 } } });
      changedDishIds.push(dish.id);
    }
    if (audit.length) await tx.auditLog.createMany({ data: audit });
    return { changed: audit.length, prices, changedDishIds };
  }, { timeout: 30000 });
}

function targetVariant(dish: PriceState, variantId: string | null) {
  if (variantId === null && (dish.isWeighted || dish.variants.length === 0)) return null;
  const variant = !dish.isWeighted && !dish.isSet && dish.variants.find(({ id }) => id === variantId);
  if (variant) return variant;
  throw new ConflictException(`Изменились варианты «${dish.name}». Обновите отчёт.`);
}
