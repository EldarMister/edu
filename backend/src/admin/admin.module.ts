import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

/** Этапы 6–7: административная часть и статистика владельца. */
@Module({
  controllers: [
    CatalogController,
    StaffController,
    AdminOrdersController,
    StatisticsController,
  ],
  providers: [CatalogService, StaffService, AdminOrdersService, StatisticsService],
})
export class AdminModule {}
