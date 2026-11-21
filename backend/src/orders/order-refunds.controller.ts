import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateOrderRefundDto, OrderRefundApprovalDto, OrderRefundSelectionDto } from './dto/order-refund.dto';
import { OrderRefundsService } from './order-refunds.service';

@Controller('order-refunds')
@RequirePermission('sections.orders')
export class OrderRefundsController {
  constructor(private readonly refunds: OrderRefundsService) {}

  @Get('pending')
  @Roles(Role.ADMIN, Role.OWNER)
  pending(@CurrentUser() user: AuthUser) {
    return this.refunds.pending(user);
  }

  @Get('orders/:orderId')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  history(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.refunds.history(user, orderId);
  }

  @Post('orders/:orderId/quote')
  @Roles(Role.WAITER, Role.ADMIN, Role.OWNER)
  quote(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Body() dto: OrderRefundSelectionDto) {
    return this.refunds.quote(user, orderId, dto);
  }

  @Post('orders/:orderId/request')
  @Roles(Role.WAITER)
  request(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Body() dto: CreateOrderRefundDto) {
    return this.refunds.create(user, orderId, dto, false);
  }

  @Post('orders/:orderId/complete')
  @Roles(Role.ADMIN, Role.OWNER)
  complete(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Body() dto: CreateOrderRefundDto) {
    return this.refunds.create(user, orderId, dto, true);
  }

  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.OWNER)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: OrderRefundApprovalDto) {
    return this.refunds.decide(user, id, 'approved', dto);
  }

  @Post(':id/reject')
  @Roles(Role.ADMIN, Role.OWNER)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.refunds.decide(user, id, 'rejected');
  }
}
