import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AdminOrdersService } from './admin-orders.service';
import { OrderQueryDto } from './dto';

@Controller('terminal/orders')
@Roles(Role.WAITER)
@RequirePermission('sections.orders', 'actions.viewAllOrders')
export class TerminalOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  list(@Query() query: OrderQueryDto) {
    return this.orders.list(query);
  }

  @Get('summary')
  summary(@Query() query: OrderQueryDto) {
    return this.orders.summary(query);
  }

  @Get('waiters')
  waiters() {
    return this.orders.waiters();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }
}
