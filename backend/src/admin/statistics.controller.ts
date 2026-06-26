import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StatisticsService } from './statistics.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { StatsQueryDto } from './dto';

// Статистика — владелец всегда; админ — только если выдано право sections.statistics.
@Controller('admin/statistics')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.statistics')
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get()
  dashboard(@Query() query: StatsQueryDto) {
    return this.statistics.dashboard(query);
  }
}
