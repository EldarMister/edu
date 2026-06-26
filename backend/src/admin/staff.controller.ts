import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StaffService } from './staff.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateStaffDto,
  SetCashHandedDto,
  ShiftHistoryQueryDto,
  UpdatePermissionsDto,
  UpdateShiftHistoryDto,
  UpdateStaffDto,
} from './dto';

@Controller('admin/staff')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('overview')
  overview(@CurrentUser() actor: AuthUser) {
    return this.staff.overview(actor);
  }

  @Get('waiter-report')
  waiterReport(
    @Query('period') period?: 'today' | 'week' | 'month',
    @Query('date') date?: string,
  ) {
    return this.staff.waiterReport(period ?? 'today', date);
  }

  @Get('shift-report')
  shiftReport(@CurrentUser() actor: AuthUser, @Query('date') date?: string) {
    return this.staff.shiftReport(date, actor);
  }

  @Post('cash-handed')
  setCashHanded(@Body() dto: SetCashHandedDto, @CurrentUser() actor: AuthUser) {
    return this.staff.setCashHanded(dto.waiterId, dto.date, dto.cashHanded, actor);
  }

  @Get('shift-history')
  shiftHistory(@Query() query: ShiftHistoryQueryDto, @CurrentUser() actor: AuthUser) {
    return this.staff.shiftHistory(query, actor);
  }

  @Patch('shift-history/:id')
  updateShiftHistory(@Param('id') id: string, @Body() dto: UpdateShiftHistoryDto, @CurrentUser() actor: AuthUser) {
    return this.staff.updateShiftHistory(id, dto, actor);
  }

  @Post('shift-history/:id/close')
  closeShiftHistory(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.staff.closeShiftHistory(id, actor);
  }

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query('role') role?: Role, @Query('search') search?: string) {
    return this.staff.list(actor, { role, search });
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.staff.getOne(id, actor);
  }

  @Post()
  create(@Body() dto: CreateStaffDto, @CurrentUser() actor: AuthUser) {
    return this.staff.create(dto, actor);
  }

  @Patch(':id/permissions')
  updatePermissions(@Param('id') id: string, @Body() dto: UpdatePermissionsDto, @CurrentUser() actor: AuthUser) {
    return this.staff.updatePermissions(id, dto, actor);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentUser() actor: AuthUser) {
    return this.staff.update(id, dto, actor);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.staff.remove(id, actor);
  }
}
