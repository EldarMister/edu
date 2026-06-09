import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PrepStation, Role } from '@prisma/client';
import { KitchenService, KitchenTab } from './kitchen.service';
import { OrdersService } from '../orders/orders.service';
import { RejectDto } from './dto/reject.dto';
import { ReadyItemsDto, RejectItemsDto } from './dto/batch.dto';
import { UpdateStopListDto } from './dto/stop-list.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('kitchen')
@Roles(Role.KITCHEN, Role.BAR, Role.ADMIN, Role.OWNER)
export class KitchenController {
  constructor(
    private readonly kitchen: KitchenService,
    private readonly orders: OrdersService,
  ) {}

  /** Станция из query (?station=kitchen|bar); по умолчанию — кухня. */
  private parseStation(value?: string): PrepStation {
    return value === PrepStation.bar ? PrepStation.bar : PrepStation.kitchen;
  }

  @Get('orders')
  list(@Query('tab') tab: KitchenTab = 'new', @Query('station') station?: string) {
    return this.kitchen.findByTab(tab, this.parseStation(station));
  }

  @Get('stop-list')
  stopList(@Query('station') station?: string) {
    return this.kitchen.getStopList(this.parseStation(station));
  }

  @Patch('stop-list')
  updateStopList(@CurrentUser() user: AuthUser, @Body() dto: UpdateStopListDto) {
    return this.kitchen.updateStopList(user, dto.items);
  }

  @Post('orders/:id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('station') station?: string) {
    return this.orders.stationAccept(id, user.id, this.parseStation(station));
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

  @Post('orders/:id/items/:itemId/ready')
  readyItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.kitchenReadyItem(id, itemId, user.id);
  }

  @Post('orders/:id/items/ready-batch')
  readyItems(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReadyItemsDto,
    @Query('station') station?: string,
  ) {
    return this.orders.kitchenReadyItems(id, dto.itemIds, user.id, this.parseStation(station));
  }

  @Post('orders/:id/items/reject-batch')
  rejectItems(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectItemsDto,
    @Query('station') station?: string,
  ) {
    const st = this.parseStation(station);
    const reason = dto.reason ?? (st === PrepStation.bar ? 'Отказ бара' : 'Отказ кухни');
    return this.orders.kitchenRejectItems(id, dto.itemIds, user.id, reason, dto.comment, st);
  }
}
