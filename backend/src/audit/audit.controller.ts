import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from './audit.service';
import { Roles } from '../common/decorators/roles.decorator';

/** Журнал действий — доступен только владельцу. Только чтение (append-only). */
@Controller('audit-logs')
@Roles(Role.OWNER)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('actionType') actionType?: string,
    @Query('entityType') entityType?: string,
    @Query('orderId') orderId?: string,
    @Query('tableId') tableId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.findMany({
      from,
      to,
      userId,
      actionType,
      entityType,
      orderId,
      tableId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('filters')
  filters() {
    return this.audit.filters();
  }
}
