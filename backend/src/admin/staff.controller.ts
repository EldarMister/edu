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
  overview() {
    return this.staff.overview();
  }

  @Get()
  list(@Query('role') role?: Role, @Query('search') search?: string) {
    return this.staff.list({ role, search });
  }

  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentUser() actor: AuthUser) {
    return this.staff.update(id, dto, actor.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.staff.remove(id, actor.id);
  }
}
