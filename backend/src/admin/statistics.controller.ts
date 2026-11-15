import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StatisticsService } from './statistics.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { StatsQueryDto } from './dto';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { hasPermission } from '../common/permissions';

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

  @Get('reports')
  reports(@Query() query: StatsQueryDto, @CurrentUser() user: AuthUser) {
    const showCosts = user.role === Role.OWNER || [
      'sections.warehouse', 'actions.warehouseCosts', 'actions.warehouseReports',
    ].every((permission) => hasPermission(user.permissions, permission));
    return this.statistics.reports(query, showCosts);
  }
}
