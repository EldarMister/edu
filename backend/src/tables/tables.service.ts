import { Injectable } from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';

@Injectable()
export class TablesService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  findAll() {
    return this.prisma.table.findMany({
      where: { isActive: true },
      orderBy: [{ hallId: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, number: true, seats: true, status: true, hallId: true },
    });
  }

  /** Меняет статус стола и оповещает всех клиентов. */
  async setStatus(tableId: string, status: TableStatus) {
    const table = await this.prisma.table.update({
      where: { id: tableId },
      data: { status },
      select: { id: true, number: true, status: true, hallId: true },
    });
    this.events.emitBroadcast(SERVER_EVENTS.TABLE_STATUS_CHANGED, table);
    return table;
  }
}
