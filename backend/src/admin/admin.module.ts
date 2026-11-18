import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { PositionsController } from './positions.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { AdminWarehouseController } from './warehouse.controller';
import { AdminWarehouseService } from './warehouse.service';
import { OrdersModule } from '../orders/orders.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { MenuEntryService } from './menu-entry.service';

/** Этапы 6–7: административная часть и статистика владельца. */
@Module({
  imports: [OrdersModule, WarehouseModule],
  controllers: [
    CatalogController,
    StaffController,
    PositionsController,
    AdminOrdersController,
    StatisticsController,
    AdminWarehouseController,
  ],
  providers: [
    CatalogService,
    MenuEntryService,
    StaffService,
    AdminOrdersService,
    StatisticsService,
    AdminWarehouseService,
  ],
})
export class AdminModule {}
