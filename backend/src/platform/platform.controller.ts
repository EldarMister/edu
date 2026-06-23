import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformService } from './platform.service';
import {
  CleanupCafeDto,
  CreateCafeDto,
  DeleteCafeDto,
  SetStaffActiveDto,
  SuspendCafeDto,
  UpdateSubscriptionDto,
} from './dto';

@Public() // пропускаем глобальные guard'ы персонала
@UseGuards(PlatformAuthGuard)
@Controller('platform/cafes')
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get()
  list() {
    return this.svc.listCafes();
  }

  @Post()
  create(@Body() dto: CreateCafeDto) {
    return this.svc.createCafe(dto);
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string, @Body() dto: SuspendCafeDto) {
    return this.svc.suspendCafe(id, dto.reason);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.svc.resumeCafe(id);
  }

  @Patch(':id/subscription')
  subscription(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.svc.updateSubscription(id, dto.paidUntil, dto.resumeIfPaid ?? true);
  }

  @Post(':id/cleanup')
  cleanup(@Param('id') id: string, @Body() dto: CleanupCafeDto) {
    return this.svc.cleanupCafe(id, dto.scopes);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Body() dto: DeleteCafeDto) {
    return this.svc.deleteCafe(id, dto.confirmName);
  }

  // Персонал кафе
  @Get(':id/staff')
  staff(@Param('id') id: string) {
    return this.svc.getCafeStaff(id);
  }

  @Patch(':id/staff/:userId')
  setStaffActive(@Param('id') id: string, @Param('userId') userId: string, @Body() dto: SetStaffActiveDto) {
    return this.svc.setStaffActive(id, userId, dto.isActive);
  }

  @Delete(':id/staff/:userId')
  deleteStaff(@Param('id') id: string, @Param('userId') userId: string) {
    return this.svc.deleteStaff(id, userId);
  }
}
