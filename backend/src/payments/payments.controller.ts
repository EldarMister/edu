import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PayDto } from './dto/pay.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  pay(@CurrentUser() user: AuthUser, @Body() dto: PayDto) {
    return this.payments.pay(user.id, dto.orderId, dto.method);
  }

  @Get(':orderId/receipt')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  receipt(@Param('orderId') orderId: string) {
    return this.payments.receipt(orderId);
  }
}
