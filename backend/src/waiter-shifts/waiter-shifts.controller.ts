import { Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { WaiterShiftsService } from './waiter-shifts.service';

@Controller('waiter/shifts')
@Roles(Role.WAITER)
export class WaiterShiftsController {
  constructor(private readonly shifts: WaiterShiftsService) {}

  @Get('current')
  current(@CurrentUser() user: AuthUser) {
    return this.shifts.currentWithStats(user.id);
  }

  @Post('start')
  start(@CurrentUser() user: AuthUser) {
    return this.shifts.start(user.id);
  }

  @Post('end')
  end(@CurrentUser() user: AuthUser) {
    return this.shifts.end(user.id);
  }
}
