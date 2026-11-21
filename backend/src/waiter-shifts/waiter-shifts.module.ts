import { Module } from '@nestjs/common';
import { WaiterShiftsController } from './waiter-shifts.controller';
import { WaiterShiftsService } from './waiter-shifts.service';
import { ShiftExpiryService } from './shift-expiry.service';
import { StaffShiftsController } from './staff-shifts.controller';

@Module({
  controllers: [WaiterShiftsController, StaffShiftsController],
  providers: [WaiterShiftsService, ShiftExpiryService],
  exports: [WaiterShiftsService],
})
export class WaiterShiftsModule {}
