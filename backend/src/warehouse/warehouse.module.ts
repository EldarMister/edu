import { Module } from '@nestjs/common';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';
import { IngredientStockService } from './ingredient-stock.service';
import { WarehouseOverviewController } from './overview.controller';
import { WarehouseOverviewService } from './overview.service';

/** Склад: сырьё, техкарты, закупки, движения. */
@Module({
  controllers: [
    IngredientsController,
    RecipesController,
    PurchasesController,
    MovementsController,
    WarehouseOverviewController,
  ],
  providers: [
    IngredientsService,
    RecipesService,
    PurchasesService,
    MovementsService,
    WarehouseOverviewService,
    IngredientStockService,
  ],
  // IngredientStockService используется заказами для списания/возврата сырья.
  exports: [IngredientStockService],
})
export class WarehouseModule {}
