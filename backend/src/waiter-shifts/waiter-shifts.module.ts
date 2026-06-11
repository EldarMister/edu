import { Module } from '@nestjs/common';
import { WaiterShiftsController } from './waiter-shifts.controller';
import { WaiterShiftsService } from './waiter-shifts.service';
import { ShiftExpiryService } from './shift-expiry.service';

@Module({
  controllers: [WaiterShiftsController],
  providers: [WaiterShiftsService, ShiftExpiryService],
  exports: [WaiterShiftsService],
})
export class WaiterShiftsModule {}
