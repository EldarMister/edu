import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
    assertAdminSectionAccess(user, 'orders', true);
    assertAdminSectionAccess(user, 'checks', true);
    return this.payments.pay(user, dto.orderId, dto.method, dto.cashAmount, dto.qrAmount, dto.splitPayments);
  }

  @Get(':orderId/receipt')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  receipt(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    assertAdminSectionAccess(user, 'checks');
    return this.payments.receipt(user, orderId);
  }
}
