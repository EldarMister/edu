import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StaffService } from './staff.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateStaffDto, UpdateStaffDto } from './dto';

@Controller('admin/staff')
@Roles(Role.ADMIN, Role.OWNER)
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

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query('role') role?: Role, @Query('search') search?: string) {
    return this.staff.list(actor, { role, search });
  }

  @Post()
  create(@Body() dto: CreateStaffDto, @CurrentUser() actor: AuthUser) {
    return this.staff.create(dto, actor);
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
