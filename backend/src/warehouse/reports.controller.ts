import { Controller, Get, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { WarehouseMovementExportQuery, WarehouseReportQuery } from './reports.dto';
import { WarehouseReportsService } from './reports.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { assertWarehousePermission } from './warehouse-permissions';

@Controller('admin/warehouse/reports')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.warehouse')
export class WarehouseReportsController {
  constructor(private readonly reports: WarehouseReportsService) {}

  @Get('export.csv')
  @RequirePermission('actions.warehouseReports')
  async exportCsv(@Query() query: WarehouseReportQuery, @Res() response: Response, @CurrentUser() user: AuthUser) {
    assertWarehousePermission(user, 'warehouseCosts');
    assertWarehousePermission(user, 'exportReports');
    const csv = await this.reports.exportCsv(query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="warehouse-report.csv"');
    response.send(csv);
  }

  @Get('export.xlsx')
  @RequirePermission('actions.warehouseReports')
  async exportXlsx(@Query() query: WarehouseMovementExportQuery, @Res() response: Response, @CurrentUser() user: AuthUser) {
    assertWarehousePermission(user, 'warehouseCosts');
    assertWarehousePermission(user, 'exportReports');
    const workbook = await this.reports.exportMovementXlsx(query);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="warehouse-movement.xlsx"');
    response.send(workbook);
  }

  @Get()
  @RequirePermission('actions.warehouseReports')
  report(@Query() query: WarehouseReportQuery, @CurrentUser() user: AuthUser) {
    assertWarehousePermission(user, 'warehouseCosts');
    return this.reports.report(query);
  }
}
