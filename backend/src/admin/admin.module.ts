import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { ReconciliationController } from './reconciliation/reconciliation.controller';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { AdminWarehouseController } from './warehouse.controller';
import { AdminWarehouseService } from './warehouse.service';
import { OrdersModule } from '../orders/orders.module';

/** Этапы 6–7: административная часть и статистика владельца. */
@Module({
  imports: [OrdersModule],
  controllers: [
    CatalogController,
    StaffController,
    AdminOrdersController,
    StatisticsController,
    ReconciliationController,
    AdminWarehouseController,
  ],
  providers: [
    CatalogService,
    StaffService,
    AdminOrdersService,
    StatisticsService,
    ReconciliationService,
    AdminWarehouseService,
  ],
})
export class AdminModule {}
