import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';

type Binding = { stockIngredientId: string | null; stockAmount: Prisma.Decimal };
type DishStockInput = Binding & {
  id: string;
  isWeighted?: boolean;
  prepStation: string | null;
  category: { prepStation: string };
  variants: Array<Binding & { id: string }>;
};

/** Compatibility quantities for menu clients come from the same station location
 * as actual consumption. No legacy stock columns or valuations are exposed. */
export async function projectDishStock(db: Prisma.TransactionClient, dishes: DishStockInput[]) {
  const cafeId = getCafeId();
  const ids = [...new Set(dishes.flatMap((dish) => [dish.stockIngredientId, ...dish.variants.map((variant) => variant.stockIngredientId)]).filter((id): id is string => !!id))];
  const [ingredients, routes, stocks] = await Promise.all([
    db.ingredient.findMany({ where: { cafeId, id: { in: ids } }, select: { id: true, stock: true, isActive: true, preparationMode: true } }),
    cafeId ? db.stationWarehouse.findMany({ where: { cafeId }, include: { warehouse: { select: { isDefault: true } } } }) : [],
    db.warehouseStock.findMany({ where: { cafeId, ingredientId: { in: ids } }, select: { warehouseId: true, ingredientId: true, stock: true } }),
  ]);
  const ingredientsById = new Map(ingredients.map((item) => [item.id, item]));
  const routesByStation = new Map(routes.map((route) => [route.stationId, route.warehouse.isDefault ? null : route.warehouseId]));
  const stockByLocation = new Map(stocks.map((row) => [`${row.warehouseId}:${row.ingredientId}`, row.stock]));
  return new Map(dishes.map((dish) => {
    const warehouseId = routesByStation.get(dish.prepStation ?? dish.category.prepStation);
    const remaining = (binding: Binding) => {
      if (!binding.stockIngredientId || binding.stockAmount.lte(0)) return null;
      const ingredient = ingredientsById.get(binding.stockIngredientId);
      if (!ingredient || !ingredient.isActive) return 0;
      if (ingredient.preparationMode === 'virtual') return null;
      const stock = warehouseId ? stockByLocation.get(`${warehouseId}:${ingredient.id}`) ?? new Prisma.Decimal(0) : ingredient.stock;
      const portions = stock.div(binding.stockAmount);
      return Number(Prisma.Decimal.max(dish.isWeighted ? portions : portions.floor(), 0));
    };
    const variantStocks = new Map(dish.variants.map((variant) => [variant.id, remaining(variant.stockIngredientId ? variant : dish)]));
    return [dish.id, { trackInventory: !!dish.stockIngredientId || dish.variants.some((variant) => !!variant.stockIngredientId), stock: remaining(dish), variantStocks }];
  }));
}
