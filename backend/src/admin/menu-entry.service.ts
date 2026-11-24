import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecipesService } from '../warehouse/recipes.service';
import { MenuModifiersService } from '../warehouse/menu-modifiers';
import { lockRecipeGraph } from '../warehouse/recipe-resolution';
import { normalizeUnit, toBase, unitLabel, unitType } from '../warehouse/units';
import { assertAssignableStation, lockStationRouting } from '../kitchen/preparation-stations';
import { normalizeDishImage, withDishImageRef } from '../dishes/dish-image';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { AuditService, AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { MenuEntryDto } from './menu-entry.dto';
import { MAIN_SCREEN, ensureMainMenuCategory } from './main-menu-category';
import { dishTaxFields } from '../settings/order-taxes';
import { createHash } from 'node:crypto';

@Injectable()
export class MenuEntryService {
  constructor(
    private prisma: PrismaService,
    private recipes: RecipesService,
    private modifiers: MenuModifiersService,
    private events: EventsGateway,
    private audit: AuditService,
  ) {}

  async get(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const dish = await tx.dish.findUnique({
          where: { id, archivedAt: null },
          include: {
            category: true,
            variants: { orderBy: { sortOrder: 'asc' } },
            setComponents: true,
          },
        });
        if (!dish) throw new NotFoundException('Позиция меню не найдена');
        return {
          dish: JSON.parse(JSON.stringify(withDishImageRef(dish))),
          recipe: await new RecipesService(tx as PrismaService).getMenuRecipe(id),
          modifiers: await new MenuModifiersService(tx as PrismaService).get(id),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async save(id: string | null, dto: MenuEntryDto, actor: AuditActor) {
    if (!id && !dto.requestKey?.trim())
      throw new BadRequestException('Не указан ключ создания позиции');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          canonical({
            catalogKind: dto.catalogKind,
            dish: dto.dish,
            recipe: dto.recipe,
            modifiers: dto.modifiers,
          }),
        ),
      )
      .digest('hex');
    const createKey = `${dto.requestKey}:${fingerprint}`;
    const imageUrl =
      dto.dish.imageUrl === undefined ? undefined : await normalizeDishImage(dto.dish.imageUrl);
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Match stock/recipe and station writers' lock order. All children commit together.
        await lockRecipeGraph(tx);
        await lockStationRouting(tx);
        if (!id) {
          const duplicate = await tx.dish.findFirst({
            where: {
              OR: [
                { menuCreateKey: dto.requestKey },
                { menuCreateKey: { startsWith: dto.requestKey + ':' } },
              ],
            },
          });
          if (duplicate) {
            if (duplicate.archivedAt) throw new ConflictException('Эта техкарта уже находится в корзине');
            if (duplicate.menuCreateKey !== createKey)
              throw new ConflictException(
                'Ключ создания уже использован с другим содержимым позиции',
              );
            return { id: duplicate.id, replay: true };
          }
        }
        const previous = id
          ? await tx.dish.findUnique({
              where: { id, archivedAt: null },
              include: { variants: true },
            })
          : null;
        if (id && !previous) throw new NotFoundException('Позиция меню не найдена');
        if (previous?.isSet)
          throw new BadRequestException('Для сета используйте редактор состава сета');
        if (previous && dto.expectedVersion !== previous.recipeVersion)
          throw new ConflictException('Позиция уже изменена. Обновите страницу перед сохранением.');
        if (previous && previous.catalogKind !== dto.catalogKind)
          throw new BadRequestException('Тип позиции нельзя менять при редактировании');
        if (
          previous?.catalogKind === 'goods' &&
          (previous.stockIngredientId ||
            previous.variants.some((variant) => variant.stockIngredientId))
        ) {
          if (dto.dish.isWeighted !== undefined && dto.dish.isWeighted !== previous.isWeighted)
            throw new BadRequestException(
              'Нельзя менять весовой режим товара с настроенным складским учётом',
            );
          if (
            previous.isWeighted &&
            dto.dish.weightedMeasure !== undefined &&
            dto.dish.weightedMeasure !== previous.weightedMeasure
          )
            throw new BadRequestException('Нельзя менять массу на объём у существующего товара');
          if (
            !previous.isWeighted &&
            dto.dish.unit !== undefined &&
            normalizeUnit(dto.dish.unit) !== normalizeUnit(previous.unit)
          )
            throw new BadRequestException('Единица существующего товара не меняется');
        }
        if (!dto.dish.name.trim()) throw new BadRequestException('Укажите название');
        const category = dto.dish.categoryId === MAIN_SCREEN ? await ensureMainMenuCategory(tx) : await tx.category.findUnique({
          where: { id: dto.dish.categoryId },
        });
        if (!category) throw new BadRequestException('Категория не найдена');
        await assertAssignableStation(tx, dto.dish.prepStation);
        const variants = dto.dish.variants;
        if (variants?.some((variant) => !variant.name.trim()))
          throw new BadRequestException('Укажите названия вариантов');
        const ids = (variants ?? []).flatMap((variant) => (variant.id ? [variant.id] : []));
        const clientKeys = (variants ?? []).flatMap((variant) =>
          variant.clientKey ? [variant.clientKey] : [],
        );
        if (new Set(clientKeys).size !== clientKeys.length)
          throw new BadRequestException('Вариант указан дважды');
        const variantIdsByClientKey = new Map<string, string>();
        if (
          new Set(ids).size !== ids.length ||
          ids.some((value) => !previous?.variants.some((variant) => variant.id === value))
        )
          throw new BadRequestException('Вариант не относится к этой позиции');
        if (
          dto.dish.trackInventory ||
          (dto.dish.stock ?? 0) !== 0 ||
          (dto.dish.initialStock ?? 0) !== 0 ||
          variants?.some(
            (variant) => (variant.stock ?? 0) !== 0 || (variant.initialStock ?? 0) !== 0,
          )
        )
          throw new BadRequestException('Остаток изменяется через поставки и инвентаризацию');
        if (dto.catalogKind === 'goods' && dto.recipe?.items.length)
          throw new BadRequestException('У товара нет состава техкарты');
        if (dto.catalogKind === 'goods' && variants?.some(({ ownRecipe }) => ownRecipe !== undefined))
          throw new BadRequestException('Отдельная техкарта доступна только для вариантов блюда');
        const producedStockId = dto.recipe?.producedStockIngredientId;
        let producedStockBinding: { stockIngredientId: string | null; stockAmount: number } | undefined;
        if (producedStockId !== undefined) {
          if (dto.catalogKind !== 'recipe') throw new BadRequestException('Складской выпуск относится к техкарте блюда');
          if (producedStockId === null) {
            if (previous?.stockIngredientId && !await tx.ingredient.findFirst({ where: { id: previous.stockIngredientId, isPrepared: true } }))
              throw new BadRequestException('Существующую складскую привязку можно изменить только в её настройках');
            producedStockBinding = { stockIngredientId: null, stockAmount: 1 };
          } else {
            const output = await tx.ingredient.findFirst({ where: { id: producedStockId, isActive: true, isPrepared: true, preparationMode: 'stocked',
              preparationRecipe: { is: { items: { some: {} } } } } });
            if (!output) throw new BadRequestException('Выберите позицию с рецептурой и учётом производства партиями');
            const weighted = dto.dish.isWeighted ?? previous?.isWeighted ?? false;
            const measure = dto.dish.weightedMeasure ?? previous?.weightedMeasure ?? 'weight';
            if (weighted && output.unitType !== (measure === 'volume' ? 'volume' : 'mass'))
              throw new BadRequestException('Единица измерения складского выпуска не соответствует весовой продаже');
            producedStockBinding = { stockIngredientId: output.id, stockAmount: weighted
              ? dto.dish.weightedPriceBase ?? previous?.weightedPriceBase ?? 100 : toBase(1, normalizeUnit(output.displayUnit)) };
          }
        }
        const price = variants?.length
          ? Math.min(...variants.map((variant) => variant.price))
          : (dto.dish.price ?? Number(previous?.price ?? 0));
        if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Укажите цену');
        const data = {
          name: dto.dish.name.trim(),
          categoryId: category.id,
          price: new Prisma.Decimal(price),
          catalogKind: dto.catalogKind,
          description: dto.dish.description,
          ...await dishTaxFields(tx, dto.dish),
          voiceName: dto.dish.voiceName,
          imageUrl,
          isAvailable: dto.dish.isAvailable,
          isWeighted: dto.dish.isWeighted,
          weightedMeasure: dto.dish.weightedMeasure,
          weightedPriceBase: dto.dish.weightedPriceBase,
          prepStation: dto.dish.prepStation,
          unit: dto.dish.unit === undefined ? undefined : unitLabel(normalizeUnit(dto.dish.unit)),
          discountType: dto.dish.discountType,
          discountValue: dto.dish.discountValue,
          cookingTime: dto.dish.cookingTime,
          ...producedStockBinding,
        };
        if (previous) await this.recipes.archiveRevision(tx, previous.id, actor);
        let dish = previous
          ? await tx.dish.update({ where: { id: previous.id }, data })
          : await tx.dish.create({
              data: { ...data, menuCreateKey: createKey },
            });
        if (variants !== undefined) {
          // Existing variant identifiers and stock bindings survive edits.
          if (previous?.catalogKind === 'goods') {
            const removed = previous.variants.filter((variant) => !ids.includes(variant.id));
            const bindings = [
              ...new Set(
                removed.flatMap((variant) =>
                  variant.stockIngredientId ? [variant.stockIngredientId] : [],
                ),
              ),
            ];
            if (!variants.length && !dish.stockIngredientId && bindings.length === 1) {
              const source = removed.find((variant) => variant.stockIngredientId === bindings[0])!;
              dish = await tx.dish.update({
                where: { id: dish.id },
                data: {
                  stockIngredientId: source.stockIngredientId,
                  stockAmount: source.stockAmount,
                  unit: source.unit,
                },
              });
            }
            for (const variant of removed) {
              if (
                !variant.stockIngredientId ||
                variant.stockIngredientId === dish.stockIngredientId ||
                previous.variants.some(
                  (kept) =>
                    ids.includes(kept.id) && kept.stockIngredientId === variant.stockIngredientId,
                )
              )
                continue;
              const stock = await tx.ingredient.findUnique({
                where: { id: variant.stockIngredientId },
              });
              const warehouseStock = await tx.warehouseStock.findFirst({
                where: {
                  ingredientId: variant.stockIngredientId,
                  stock: { not: 0 },
                },
              });
              if ((stock && !stock.stock.isZero()) || warehouseStock)
                throw new BadRequestException(
                  `У варианта «${variant.name}» есть остаток. Сначала израсходуйте или спишите его.`,
                );
            }
          }
          await tx.dishVariant.deleteMany({
            where: { dishId: dish.id, id: { notIn: ids } },
          });
          for (const [sortOrder, variant] of variants.entries()) {
            const existingVariant = previous?.variants.find((item) => item.id === variant.id);
            const unit = normalizeUnit(variant.unit ?? existingVariant?.unit ?? dish.unit);
            const existingBinding = existingVariant && (existingVariant.stockIngredientId || dish.stockIngredientId);
            const reusesProductStock = dish.stockIngredientId && sortOrder === 0 && !previous?.variants.length;
            if (dto.catalogKind === 'goods' && (
              (existingBinding && unit !== normalizeUnit(existingVariant.unit)) ||
              (reusesProductStock && unit !== normalizeUnit(dish.unit))
            )) throw new BadRequestException('Единица товара с настроенным складским учётом не меняется');
            const variantData = {
              name: variant.name.trim(),
              price: new Prisma.Decimal(variant.price),
              sortOrder,
              unit: unitLabel(unit),
              ...(variant.ownRecipe !== undefined && {
                recipeMetadata: variant.ownRecipe ? (variant.ownRecipe.metadata ?? {}) as Prisma.InputJsonValue : Prisma.DbNull,
              }),
            };
            const saved = variant.id
              ? await tx.dishVariant.update({
                  where: { id: variant.id },
                  data: variantData,
                })
              : await tx.dishVariant.create({
                  data: { dishId: dish.id, ...variantData },
                });
            if (variant.clientKey) variantIdsByClientKey.set(variant.clientKey, saved.id);
            if (variant.ownRecipe !== undefined) {
              if (variant.ownRecipe && (dish.stockIngredientId || saved.stockIngredientId))
                throw new BadRequestException('Отдельная техкарта варианта недоступна при продаже готовой позиции со склада');
              if (variant.ownRecipe && !variant.ownRecipe.items.length)
                throw new BadRequestException(`Добавьте продукты в состав варианта «${saved.name}»`);
              await this.recipes.saveRecipeItems(tx, dish.id, variant.ownRecipe?.items ?? [], {
                variantId: saved.id, inputPortions: variant.ownRecipe?.inputPortions,
              });
            }
          }
        }
        if (dish.stockIngredientId && dto.catalogKind === 'recipe' && await tx.dishVariant.findFirst({
          where: { dishId: dish.id, recipeMetadata: { not: Prisma.DbNull } }, select: { id: true },
        })) throw new BadRequestException('Сначала переведите варианты блюда на общий состав');
        if (dto.catalogKind === 'goods') {
          if (previous?.isWeighted && dish.weightedPriceBase !== previous.weightedPriceBase) {
            dish = await tx.dish.update({
              where: { id: dish.id },
              data: {
                stockAmount: previous.stockAmount
                  .mul(dish.weightedPriceBase)
                  .div(previous.weightedPriceBase),
              },
            });
          }
          // One visible product. Its stock identity is created automatically, never by name matching.
          const savedVariants = await tx.dishVariant.findMany({
            where: { dishId: dish.id },
            orderBy: { sortOrder: 'asc' },
          });
          if (!savedVariants.length && !dish.stockIngredientId) {
            const unit = normalizeUnit(
              dish.isWeighted ? (dish.weightedMeasure === 'volume' ? 'ml' : 'g') : dish.unit,
            );
            const ingredient = await tx.ingredient.create({
              data: {
                name: dish.name,
                kind: 'goods',
                unitType: unitType(unit),
                displayUnit: unit,
              },
            });
            dish = await tx.dish.update({
              where: { id: dish.id },
              data: {
                stockIngredientId: ingredient.id,
                stockAmount: dish.isWeighted ? dish.weightedPriceBase : toBase(1, unit),
              },
            });
          }
          for (const [index, variant] of savedVariants.entries()) {
            if (variant.stockIngredientId) continue;
            if (dish.stockIngredientId && previous?.variants.some((item) => item.id === variant.id))
              continue;
            if (dish.stockIngredientId && index === 0 && !previous?.variants.length) {
              await tx.dishVariant.update({
                where: { id: variant.id },
                data: {
                  stockIngredientId: dish.stockIngredientId,
                  stockAmount: dish.stockAmount,
                },
              });
              continue;
            }
            const unit = normalizeUnit(variant.unit);
            const ingredient = await tx.ingredient.create({
              data: {
                name: `${dish.name} — ${variant.name}`,
                kind: 'goods',
                unitType: unitType(unit),
                displayUnit: unit,
              },
            });
            await tx.dishVariant.update({
              where: { id: variant.id },
              data: {
                stockIngredientId: ingredient.id,
                stockAmount: toBase(1, unit),
              },
            });
          }
          if (dish.menuCreateKey && dish.stockIngredientId && !savedVariants.length) {
            const uses = await tx.dish.count({
              where: { stockIngredientId: dish.stockIngredientId },
            });
            const variantUses = await tx.dishVariant.count({
              where: { stockIngredientId: dish.stockIngredientId },
            });
            if (uses === 1 && variantUses === 0)
              await tx.ingredient.update({
                where: { id: dish.stockIngredientId },
                data: { name: dish.name },
              });
          }
        }
        if (dto.recipe) {
          const rows = dto.recipe.items.map((row) => row.variantAmounts ? {
            ...row,
            variantAmounts: Object.fromEntries(Object.entries(row.variantAmounts)
              .map(([key, amount]) => [variantIdsByClientKey.get(key) ?? key, amount])),
          } : row);
          await this.recipes.saveRecipeItems(tx, dish.id, rows, { inputPortions: dto.recipe.inputPortions });
          if (dto.recipe.metadata !== undefined)
            await tx.dish.update({
              where: { id: dish.id },
              data: {
                recipeMetadata: dto.recipe.metadata as Prisma.InputJsonValue,
              },
            });
        }
        if (dto.modifiers)
          await this.modifiers.saveInTransaction(tx, dish.id, dto.modifiers, false);
        if (previous)
          await tx.dish.update({
            where: { id: dish.id },
            data: { recipeVersion: { increment: 1 } },
          });
        return { id: dish.id, replay: false };
      },
      { timeout: 30000 },
    );
    if (!result.replay) {
      this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, {
        dishId: result.id,
      });
      await this.audit.log({
        actor,
        actionType: id ? AuditAction.MENU_ITEM_UPDATED : AuditAction.MENU_ITEM_CREATED,
        entityType: AuditEntity.MENU_ITEM,
        entityId: result.id,
        description: `${id ? 'Изменена' : 'Добавлена'} позиция меню «${dto.dish.name}»`,
        newValue: { catalogKind: dto.catalogKind, name: dto.dish.name },
      });
    }
    return this.get(result.id);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
