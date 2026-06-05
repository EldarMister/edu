import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';
import { Roles } from '../common/decorators/roles.decorator';
import { OrderQueryDto } from './dto';

@Controller('admin/orders')
@Roles(Role.ADMIN, Role.OWNER)
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get('overview')
  overview() {
    return this.orders.overview();
  }

  @Get()
  list(@Query() query: OrderQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }
}
