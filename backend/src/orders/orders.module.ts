import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { WaiterShiftsModule } from '../waiter-shifts/waiter-shifts.module';
import { PushModule } from '../push/push.module';
import { SettingsModule } from '../settings/settings.module';
import { DishesModule } from '../dishes/dishes.module';
import { WarehouseModule } from '../warehouse/warehouse.module';

@Module({
  imports: [WaiterShiftsModule, PushModule, SettingsModule, DishesModule, WarehouseModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
