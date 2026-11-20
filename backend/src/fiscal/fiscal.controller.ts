import { Controller, ForbiddenException, Param, Post, Query } from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { FiscalService } from './fiscal.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { assertReceiptPrintOperator, terminalReceiptOrderScope } from '../receipt-prints/receipt-print-access';
import { PrismaService } from '../prisma/prisma.service';

@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService, private readonly prisma: PrismaService) {}

  /** Проверка соединения с ККМ — кнопка в настройках (только владелец). */
  @Post('test-connection')
  @Roles(Role.OWNER)
  async testConnection() {
    const ok = await this.fiscal.testConnection();
    return { ok };
  }

  /** Фискализация при печати чека (идемпотентно: если уже пробит — вернёт существующий). */
  @Post('orders/:orderId/print')
  @Roles(Role.ADMIN, Role.OWNER, Role.WAITER)
  async print(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Query('requestId') requestId?: string) {
    if (user.role === Role.WAITER) {
      const order = await this.prisma.order.findFirst({
        where: { ...terminalReceiptOrderScope(user, requestId, true), id: orderId, status: OrderStatus.paid },
        select: { id: true },
      });
      if (!order) throw new ForbiddenException('Нет доступа к печати этого чека');
    } else {
      assertReceiptPrintOperator(user, true);
    }
    return this.fiscal.fiscalizeOrder(orderId);
  }

  /** Повторить фискализацию заказа — кнопка «Повторить» в карточке заказа. */
  @Post('orders/:orderId/retry')
  @RequirePermission('sections.checks')
  @Roles(Role.ADMIN, Role.OWNER)
  retry(@Param('orderId') orderId: string) {
    return this.fiscal.fiscalizeOrder(orderId);
  }
}
