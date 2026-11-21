import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderRefundsController } from './order-refunds.controller';
import { OrderRefundsService } from './order-refunds.service';
import { WaiterShiftsModule } from '../waiter-shifts/waiter-shifts.module';
import { PushModule } from '../push/push.module';
import { SettingsModule } from '../settings/settings.module';
import { DishesModule } from '../dishes/dishes.module';
import { WarehouseModule } from '../warehouse/warehouse.module';

@Module({
  imports: [WaiterShiftsModule, PushModule, SettingsModule, DishesModule, WarehouseModule],
  controllers: [OrdersController, OrderRefundsController],
  providers: [OrdersService, OrderRefundsService],
  exports: [OrdersService],
})
export class OrdersModule {}
