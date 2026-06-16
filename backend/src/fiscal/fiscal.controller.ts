import { Controller, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FiscalService } from './fiscal.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  /** Проверка соединения с ККМ — кнопка в настройках (только владелец). */
  @Post('test-connection')
  @Roles(Role.OWNER)
  async testConnection() {
    const ok = await this.fiscal.testConnection();
    return { ok };
  }

  /** Фискализация при печати чека (идемпотентно: если уже пробит — вернёт существующий). */
  @Post('orders/:orderId/print')
  @Roles(Role.ADMIN, Role.OWNER)
  print(@Param('orderId') orderId: string) {
    return this.fiscal.fiscalizeOrder(orderId, false);
  }

  /** Повторить фискализацию заказа — кнопка «Повторить» в карточке заказа. */
  @Post('orders/:orderId/retry')
  @Roles(Role.ADMIN, Role.OWNER)
  retry(@Param('orderId') orderId: string) {
    return this.fiscal.fiscalizeOrder(orderId, true);
  }
}
