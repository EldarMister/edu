import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { KitchenService, KitchenTab } from './kitchen.service';
import { OrdersService } from '../orders/orders.service';
import { RejectDto } from './dto/reject.dto';
import { UpdateStopListDto } from './dto/stop-list.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('kitchen')
@Roles(Role.KITCHEN, Role.ADMIN, Role.OWNER)
export class KitchenController {
  constructor(
    private readonly kitchen: KitchenService,
    private readonly orders: OrdersService,
  ) {}

  @Get('orders')
  list(@Query('tab') tab: KitchenTab = 'new') {
    return this.kitchen.findByTab(tab);
  }

  @Get('stop-list')
  stopList() {
    return this.kitchen.getStopList();
  }

  @Patch('stop-list')
  updateStopList(@CurrentUser() user: AuthUser, @Body() dto: UpdateStopListDto) {
    return this.kitchen.updateStopList(user, dto.items);
  }

  @Post('orders/:id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.kitchenAccept(id, user.id);
  }

  @Post('orders/:id/ready')
  ready(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.kitchenReady(id, user.id);
  }

  @Post('orders/:id/reject')
  rejectOrder(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: RejectDto) {
    return this.orders.kitchenRejectOrder(id, user.id, dto.reason, dto.comment);
  }

  @Post('orders/:id/items/:itemId/reject')
  rejectItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectDto,
  ) {
    return this.orders.kitchenRejectItem(id, itemId, user.id, dto.reason, dto.comment);
  }
}
