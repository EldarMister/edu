import { Module } from '@nestjs/common';
import { WaiterShiftsController } from './waiter-shifts.controller';
import { WaiterShiftsService } from './waiter-shifts.service';

@Module({
  controllers: [WaiterShiftsController],
  providers: [WaiterShiftsService],
  exports: [WaiterShiftsService],
})
export class WaiterShiftsModule {}
