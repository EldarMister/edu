import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PayDto } from './dto/pay.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { assertAdminSectionAccess } from '../common/admin-section-access';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  pay(@CurrentUser() user: AuthUser, @Body() dto: PayDto) {
    if (user.role === Role.WAITER && !user.permissions.actions.acceptOrderPayments) {
      throw new ForbiddenException('Для вашей должности отключён приём оплаты');
    }
    assertAdminSectionAccess(user, 'orders', true);
    assertAdminSectionAccess(user, 'checks', true);
    return this.payments.pay(user, dto.orderId, dto.method, dto.cashAmount, dto.qrAmount, dto.splitPayments);
  }

  @Get(':orderId/receipt')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  receipt(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Query('print') print?: string, @Query('requestId') requestId?: string) {
    assertAdminSectionAccess(user, 'checks', print === 'true');
    return this.payments.receipt(user, orderId, print === 'true' ? { requestId } : undefined);
  }
}
