import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { WaiterShiftsModule } from '../waiter-shifts/waiter-shifts.module';

@Module({
  imports: [WaiterShiftsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
