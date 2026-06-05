import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StatisticsService } from './statistics.service';
import { Roles } from '../common/decorators/roles.decorator';
import { StatsQueryDto } from './dto';

// Статистика — только владелец (ТЗ §7, §12: официант/админ её не видят).
@Controller('admin/statistics')
@Roles(Role.OWNER)
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get()
  dashboard(@Query() query: StatsQueryDto) {
    return this.statistics.dashboard(query.period ?? 'month');
  }
}
