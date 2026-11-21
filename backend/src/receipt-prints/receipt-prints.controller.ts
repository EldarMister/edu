import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ReceiptPrintType, Role } from '@prisma/client';
import { ReceiptPrintsService } from './receipt-prints.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { assertReceiptPrintOperator } from './receipt-print-access';
import { assertOwnerOperation } from '../common/permissions';

@Controller('receipt-prints')
export class ReceiptPrintsController {
  constructor(private readonly service: ReceiptPrintsService) {}

  /** Официант создаёт запрос на печать чека (обычного или предварительного). */
  @Post()
  @Roles(Role.WAITER)
  @RequirePermission('actions.requestReceiptPrints')
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: { orderId: string; type?: ReceiptPrintType },
  ) {
    return this.service.create(user, body.orderId, body.type);
  }

  /** Администратор видит список ожидающих заявок. */
  @Get()
  @Roles(Role.ADMIN, Role.OWNER, Role.WAITER)
  list(@CurrentUser() user: AuthUser) {
    assertOwnerOperation(user, 'printRequests');
    assertReceiptPrintOperator(user);
    return this.service.listPending(user.role === Role.WAITER ? user.id : undefined);
  }

  /** Администратор принимает заявку — чек печатается. */
  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.OWNER, Role.WAITER)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertOwnerOperation(user, 'printRequests');
    assertReceiptPrintOperator(user, true);
    return this.service.approve(user, id);
  }

  /** Администраторское устройство подтвердило, что печать действительно завершилась. */
  @Post(':id/printed')
  @Roles(Role.ADMIN, Role.OWNER, Role.WAITER)
  printed(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertOwnerOperation(user, 'printRequests');
    assertReceiptPrintOperator(user, true);
    return this.service.markPrinted(user, id);
  }

  /** Администратор отклоняет заявку — чек не печатается. */
  @Post(':id/reject')
  @Roles(Role.ADMIN, Role.OWNER, Role.WAITER)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertOwnerOperation(user, 'printRequests');
    assertReceiptPrintOperator(user, true);
    return this.service.reject(user, id);
  }
}
