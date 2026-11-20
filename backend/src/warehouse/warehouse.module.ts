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
import { WarehouseLocationsController } from './locations.controller';
import { WarehouseLocationsService } from './locations.service';
import { WarehouseDocumentsController } from './documents.controller';
import { WarehouseDocumentsService } from './documents.service';
import { WarehouseReportsController } from './reports.controller';
import { WarehouseReportsService } from './reports.service';
import { WarehousePolicyController } from './policy.controller';
import { WarehouseSuppliersModule } from './suppliers';
import { WarehousePackagesModule } from './packages';
import { ProcessingModule } from './processing';
import { MenuModifiersController, MenuModifiersService } from './menu-modifiers';

/** Склад: сырьё, техкарты, закупки, движения. */
@Module({
  imports: [WarehouseSuppliersModule, WarehousePackagesModule, ProcessingModule],
  controllers: [
    IngredientsController,
    RecipesController,
    PurchasesController,
    MovementsController,
    WarehouseOverviewController,
    WarehouseLocationsController,
    WarehouseDocumentsController,
    WarehouseReportsController,
    WarehousePolicyController,
    MenuModifiersController,
  ],
  providers: [
    IngredientsService,
    RecipesService,
    PurchasesService,
    MovementsService,
    WarehouseOverviewService,
    WarehouseLocationsService,
    WarehouseDocumentsService,
    WarehouseReportsService,
    IngredientStockService,
    MenuModifiersService,
  ],
  // IngredientStockService используется заказами для списания/возврата сырья.
  exports: [IngredientStockService, RecipesService, MenuModifiersService],
})
export class WarehouseModule {}
