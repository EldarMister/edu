import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ReceiptPrintsService } from './receipt-prints.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('receipt-prints')
export class ReceiptPrintsController {
  constructor(private readonly service: ReceiptPrintsService) {}

  /** Официант создаёт запрос на печать чека. */
  @Post()
  @Roles(Role.WAITER)
  create(@CurrentUser() user: AuthUser, @Body() body: { orderId: string }) {
    return this.service.create(user, body.orderId);
  }

  /** Администратор видит список ожидающих заявок. */
  @Get()
  @Roles(Role.ADMIN)
  list() {
    return this.service.listPending();
  }

  /** Администратор принимает заявку — чек печатается. */
  @Post(':id/approve')
  @Roles(Role.ADMIN)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user, id);
  }

  /** Администратор отклоняет заявку — чек не печатается. */
  @Post(':id/reject')
  @Roles(Role.ADMIN)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reject(user, id);
  }
}
