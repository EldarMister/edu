import { Body, Controller, Get, Param, Patch, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AdminOrdersService } from './admin-orders.service';
import { OrdersService } from '../orders/orders.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { OrderExportQueryDto, OrderQueryDto, UpdateOrderStatusDto } from './dto';

@Controller('admin/orders')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.orders')
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly orderActions: OrdersService,
  ) {}

  @Get('overview')
  overview() {
    return this.orders.overview();
  }

  @Get('summary')
  summary(@Query() query: OrderQueryDto) {
    return this.orders.summary(query);
  }

  @Get('waiters')
  waiters() {
    return this.orders.waiters();
  }

  @Get()
  list(@Query() query: OrderQueryDto) {
    return this.orders.list(query);
  }

  @Get('export.xlsx')
  @RequirePermission('actions.exportReports')
  async exportOrders(@Query() query: OrderExportQueryDto, @Res() response: Response) {
    const workbook = await this.orders.exportOrders(query);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="receipts.xlsx"');
    response.send(workbook);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @Get(':id/stock-movements')
  @RequirePermission('sections.warehouse')
  stockMovements(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.stockMovements(id, user);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateOrderStatusDto) {
    return this.orderActions.adminUpdateStatus(id, user, dto.status, dto.reason);
  }
}
