import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AddItemsDto } from './dto/add-items.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Roles(Role.WAITER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Get('active')
  @Roles(Role.WAITER)
  active(@CurrentUser() user: AuthUser) {
    return this.orders.findActiveForWaiter(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findById(id);
  }

  @Post(':id/items')
  @Roles(Role.WAITER)
  addItems(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: AddItemsDto) {
    return this.orders.addItems(id, user.id, dto.items, dto.idempotencyKey);
  }

  @Post(':id/picked-up')
  @Roles(Role.WAITER)
  pickedUp(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.pickedUp(id, user.id);
  }

  @Post(':id/served')
  @Roles(Role.WAITER)
  served(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.served(id, user.id);
  }

  @Post(':id/to-payment')
  @Roles(Role.WAITER)
  toPayment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.toPayment(id, user.id);
  }
}
