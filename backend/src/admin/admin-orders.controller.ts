import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';
import { OrdersService } from '../orders/orders.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { OrderQueryDto, UpdateOrderStatusDto } from './dto';

@Controller('admin/orders')
@Roles(Role.ADMIN, Role.OWNER)
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

  @Get()
  list(@Query() query: OrderQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateOrderStatusDto) {
    return this.orderActions.adminUpdateStatus(id, user, dto.status, dto.reason);
  }
}
