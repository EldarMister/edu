import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { WarehouseOverviewService } from './overview.service';

@Controller('admin/warehouse/overview')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.warehouse')
export class WarehouseOverviewController {
  constructor(private readonly overview: WarehouseOverviewService) {}

  @Get()
  getOverview(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.overview.getOverview({ dateFrom, dateTo, warehouseId });
  }
}
