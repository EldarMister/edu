import { Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { WaiterShiftsService, WORK_SHIFT_ROLES } from './waiter-shifts.service';

/** Each employee controls only their own work time; back-office permissions are unrelated. */
@Controller('staff/shifts')
@Roles(...WORK_SHIFT_ROLES)
export class StaffShiftsController {
  constructor(private readonly shifts: WaiterShiftsService) {}

  @Get('current')
  @Roles(...WORK_SHIFT_ROLES, Role.OWNER)
  current(@CurrentUser() user: AuthUser) {
    return user.role === Role.OWNER ? null : this.shifts.currentWithStats(user.id);
  }

  @Post('start')
  start(@CurrentUser() user: AuthUser, @Query('awaitApproval') awaitApproval?: string) {
    return this.shifts.startStaff(user.id, awaitApproval === 'true');
  }

  @Get('start-request')
  startRequest(@CurrentUser() user: AuthUser) {
    return this.shifts.requestState(user.id);
  }

  @Post('end')
  end(@CurrentUser() user: AuthUser) {
    return this.shifts.endStaff(user.id);
  }
}
