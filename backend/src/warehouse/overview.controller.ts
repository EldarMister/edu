import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { WarehouseOverviewService } from './overview.service';

@Controller('admin/warehouse/overview')
@Roles(Role.ADMIN, Role.OWNER)
export class WarehouseOverviewController {
  constructor(private readonly overview: WarehouseOverviewService) {}

  @Get()
  getOverview(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.overview.getOverview({ dateFrom, dateTo });
  }
}
