import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SaveTaxDto, TaxListQuery, TaxReportQuery } from './taxes.dto';
import { TaxesService } from './taxes.service';

@Controller('admin')
@Roles(Role.ADMIN, Role.OWNER)
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get('settings/taxes') @RequirePermission('sections.settings')
  list(@Query() query: TaxListQuery) { return this.taxes.list(query); }

  @Get('settings/taxes/export.xlsx') @RequirePermission('sections.settings', 'actions.exportReports')
  async exportList(@Query() query: TaxListQuery, @Res() response: Response) {
    this.download(response, await this.taxes.exportList(query), 'tax-rates.xlsx');
  }

  @Post('settings/taxes') @RequirePermission('sections.settings')
  create(@Body() dto: SaveTaxDto, @CurrentUser() actor: AuthUser) { return this.taxes.save(dto, actor); }

  @Patch('settings/taxes/:id') @RequirePermission('sections.settings')
  update(@Param('id') id: string, @Body() dto: SaveTaxDto, @CurrentUser() actor: AuthUser) { return this.taxes.save(dto, actor, id); }

  @Delete('settings/taxes/:id') @RequirePermission('sections.settings')
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) { return this.taxes.remove(id, actor); }

  @Get('menu/taxes') @RequirePermission('sections.menu')
  menuOptions() { return this.taxes.list(); }

  @Get('statistics/taxes') @RequirePermission('sections.statistics')
  report(@Query() query: TaxReportQuery) { return this.taxes.report(query); }

  @Get('statistics/taxes/export.xlsx') @RequirePermission('sections.statistics', 'actions.exportReports')
  async exportReport(@Query() query: TaxReportQuery, @Res() response: Response) {
    this.download(response, await this.taxes.exportReport(query), 'sales-taxes.xlsx');
  }

  private download(response: Response, buffer: Buffer, filename: string) {
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.send(buffer);
  }
}
