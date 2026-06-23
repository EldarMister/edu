import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { setCafeId } from '../tenant/tenant-context';

/** Статусы заказа, в которых он ещё готовится (левая колонка табло). */
const PREPARING_STATUSES: OrderStatus[] = [
  OrderStatus.sent_to_kitchen,
  OrderStatus.accepted_by_kitchen,
  OrderStatus.cooking,
  OrderStatus.partially_rejected,
];

export interface QueueOrderDto {
  id: string;
  orderNumber: string;
  tableNumber: number;
  status: OrderStatus;
  createdAt: Date;
  /** Время последнего изменения — момент готовности для колонки «Готовы». */
  updatedAt: Date;
}

export interface QueueBoardDto {
  enabled: boolean;
  mode: 'table' | 'number';
  cafeName: string;
  preparing: QueueOrderDto[];
  ready: QueueOrderDto[];
}

@Injectable()
export class QueueService {
  constructor(private prisma: PrismaService) {}

  /**
   * Состояние табло очереди заказов. Считает по заказу целиком (кухня + бар):
   * «Готовятся» — заказ в работе, «Готовы» — все позиции готовы, но ещё не
   * забраны/поданы/оплачены. Публичный метод (табло висит в зале без входа).
   */
  async getBoard(opts: { cafeId?: string; code?: string } = {}): Promise<QueueBoardDto> {
    // Табло висит без входа, поэтому кафе определяем из ссылки: либо короткий
    // код (/q/CODE — для ввода на ТВ), либо cafeId (?cafe=…). Найденный cafeId
    // кладём в контекст тенанта — дальше settings/orders скоупятся сами.
    // Без идентификатора (одно кафе на стенде) — по единственной строке.
    let cafeId = opts.cafeId;
    if (opts.code) {
      const row = await this.prisma.settings.findFirst({
        where: { queueDisplayCode: opts.code },
        select: { cafeId: true },
      });
      if (!row) {
        return { enabled: false, mode: 'table', cafeName: '', preparing: [], ready: [] };
      }
      cafeId = row.cafeId ?? undefined;
    }
    if (cafeId) setCafeId(cafeId);

    const settings = await this.prisma.settings.findFirst({
      select: { cafeName: true, queueDisplayEnabled: true, queueDisplayMode: true },
    });

    const mode = settings?.queueDisplayMode === 'number' ? 'number' : 'table';
    if (!settings?.queueDisplayEnabled) {
      return { enabled: false, mode, cafeName: settings?.cafeName ?? '', preparing: [], ready: [] };
    }

    const orders = await this.prisma.order.findMany({
      where: { status: { in: [...PREPARING_STATUSES, OrderStatus.ready] } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        table: { select: { number: true } },
      },
    });

    const toDto = (o: (typeof orders)[number]): QueueOrderDto => ({
      id: o.id,
      orderNumber: o.orderNumber,
      tableNumber: o.table.number,
      status: o.status,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });

    // «Готовятся» — недавние сверху; «Готовы» — только что приготовленные сверху.
    const preparing = orders
      .filter((o) => o.status !== OrderStatus.ready)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(toDto);
    const ready = orders
      .filter((o) => o.status === OrderStatus.ready)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toDto);

    return { enabled: true, mode, cafeName: settings.cafeName, preparing, ready };
  }
}
