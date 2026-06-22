import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformService } from './platform.service';
import { CreateCafeDto, SuspendCafeDto, UpdateSubscriptionDto } from './dto';

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
}
