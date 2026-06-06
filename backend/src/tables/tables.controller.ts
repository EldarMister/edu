import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TablesService } from './tables.service';
import { OrdersService } from '../orders/orders.service';
import { MoveTableDto, TransferTableDto } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('tables')
export class TablesController {
  constructor(
    private readonly tables: TablesService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  findAll() {
    return this.tables.findAll();
  }

  /** Официанты на смене — для передачи стола. */
  @Get('available-waiters')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  availableWaiters() {
    return this.orders.availableWaiters();
  }

  @Post(':id/close')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.closeTable(id, user);
  }

  @Post(':id/move')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  move(@Param('id') id: string, @Body() dto: MoveTableDto, @CurrentUser() user: AuthUser) {
    return this.orders.moveTable(id, dto.targetTableId, user);
  }

  @Post(':id/transfer')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  transfer(@Param('id') id: string, @Body() dto: TransferTableDto, @CurrentUser() user: AuthUser) {
    return this.orders.transferTable(id, dto.waiterId, user);
  }
}
