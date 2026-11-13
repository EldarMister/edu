import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveStation } from './preparation-stations';
import { KitchenService, KitchenStatsPeriod, KitchenTab } from './kitchen.service';
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
    private readonly prisma: PrismaService,
  ) {}

  @Get('orders')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('tab') tab: KitchenTab = 'new',
    @Query('station') station?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.kitchen.findByTab(tab, selected.id, from, to);
  }

  @Get('statistics')
  async statistics(
    @CurrentUser() user: AuthUser,
    @Query('period') period: KitchenStatsPeriod = 'today',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('station') station?: string,
  ) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.kitchen.statistics(period, from, to, selected.id);
  }

  @Get('stop-list')
  async stopList(@CurrentUser() user: AuthUser, @Query('station') station?: string) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.kitchen.getStopList(selected.id);
  }

  @Patch('stop-list')
  async updateStopList(@CurrentUser() user: AuthUser, @Body() dto: UpdateStopListDto, @Query('station') station?: string) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.kitchen.updateStopList(user, dto.items, selected.id);
  }

  @Post('orders/:id/accept')
  async accept(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('station') station?: string) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.orders.stationAccept(id, user.id, selected.id, selected.name);
  }

  @Post('orders/:id/ready')
  async ready(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('station') station?: string) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.orders.kitchenReadyStation(id, user.id, selected.id);
  }

  @Post('orders/:id/reject')
  async rejectOrder(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: RejectDto, @Query('station') station?: string) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.orders.kitchenRejectStation(id, user.id, selected.id, dto.reason, dto.comment, selected.name);
  }

  @Post('orders/:id/items/:itemId/reject')
  async rejectItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectDto,
    @Query('station') station?: string,
  ) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.orders.kitchenRejectItems(id, [itemId], user.id, dto.reason, dto.comment, selected.id, [], [], selected.name);
  }

  @Post('orders/:id/items/:itemId/ready')
  async readyItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser,
    @Query('station') station?: string,
  ) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.orders.kitchenReadyItems(id, [itemId], user.id, selected.id);
  }

  @Post('orders/:id/items/ready-batch')
  async readyItems(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReadyItemsDto,
    @Query('station') station?: string,
  ) {
    const selected = await resolveStation(this.prisma, user, station);
    return this.orders.kitchenReadyItems(
      id,
      dto.itemIds ?? [],
      user.id,
      selected.id,
      dto.setComponentIds ?? [],
      dto.partial ?? [],
    );
  }

  @Post('orders/:id/items/reject-batch')
  async rejectItems(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectItemsDto,
    @Query('station') station?: string,
  ) {
    const selected = await resolveStation(this.prisma, user, station);
    const reason = dto.reason ?? `Отказ станции «${selected.name}»`;
    return this.orders.kitchenRejectItems(
      id,
      dto.itemIds ?? [],
      user.id,
      reason,
      dto.comment,
      selected.id,
      dto.setComponentIds ?? [],
      dto.partial ?? [],
      selected.name,
    );
  }
}
