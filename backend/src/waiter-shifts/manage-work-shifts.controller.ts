import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { WaiterShiftsService } from './waiter-shifts.service';

class ManagedShiftStartDto {
  @IsOptional() @IsUUID() requestId?: string;
}

@Controller('admin/work-shifts')
@Roles(Role.OWNER, Role.ADMIN)
@RequirePermission('sections.staff', 'actions.closeShift')
export class ManageWorkShiftsController {
  constructor(private readonly shifts: WaiterShiftsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser) {
    if (!actor.cafeId) throw new ForbiddenException('Заведение не назначено');
    return this.shifts.manageList(actor.cafeId);
  }

  @Post(':employeeId/start')
  start(@CurrentUser() actor: AuthUser, @Param('employeeId') employeeId: string, @Body() dto: ManagedShiftStartDto) {
    return this.shifts.startManaged(actor, employeeId, dto?.requestId);
  }

  @Post(':employeeId/requests/:requestId/reject')
  reject(@CurrentUser() actor: AuthUser, @Param('employeeId') employeeId: string, @Param('requestId') requestId: string) {
    return this.shifts.rejectRequest(actor, employeeId, requestId);
  }
}
