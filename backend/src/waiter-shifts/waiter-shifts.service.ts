import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, WaiterShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { SettingsService } from '../settings/settings.service';
import { StartShiftDto } from './dto';

const CLOSED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.paid,
  OrderStatus.cancelled,
  OrderStatus.rejected,
];

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WaiterShiftsService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private settings: SettingsService,
  ) {}

  current(waiterId: string, client: PrismaClientLike = this.prisma) {
    return client.waiterShift.findFirst({
      where: { waiterId, status: WaiterShiftStatus.active },
      orderBy: { startedAt: 'desc' },
    });
  }

  async currentWithStats(waiterId: string) {
    const shift = await this.current(waiterId);
    if (!shift) return null;

    const [ordersCount, activeOrdersCount, totals] = await Promise.all([
      this.prisma.order.count({
        where: {
          waiterShiftId: shift.id,
          status: { notIn: [OrderStatus.cancelled] },
        },
      }),
      this.prisma.order.count({
        where: {
          waiterShiftId: shift.id,
          status: { notIn: CLOSED_ORDER_STATUSES },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          waiterShiftId: shift.id,
          status: { notIn: [OrderStatus.cancelled] },
        },
        _sum: { finalAmount: true },
      }),
    ]);

    return {
      ...shift,
      stats: {
        ordersCount,
        totalAmount: String(totals._sum.finalAmount ?? 0),
        activeOrdersCount,
      },
    };
  }

  async getRequiredActiveShift(waiterId: string, client: PrismaClientLike = this.prisma) {
    const shift = await this.current(waiterId, client);
    if (!shift) {
      throw new BadRequestException('Сначала начните смену.');
    }
    return shift;
  }

  async start(waiterId: string, location?: StartShiftDto) {
    const active = await this.current(waiterId);
    if (active) {
      throw new BadRequestException('Смена уже активна.');
    }
    await this.assertShiftLocation(location);

    const shift = await this.prisma.waiterShift.create({
      data: {
        waiterId,
        status: WaiterShiftStatus.active,
      },
    });

    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    return shift;
  }

  private async assertShiftLocation(location?: StartShiftDto) {
    const settings = await this.settings.ensure();
    if (!settings.shiftLocationEnabled) return;
    if (settings.cafeLatitude === null || settings.cafeLongitude === null) {
      throw new BadRequestException('Местоположение кафе не настроено');
    }
    if (location?.latitude === undefined || location.longitude === undefined) {
      throw new BadRequestException('Для начала смены разрешите доступ к геолокации');
    }
    const distance = distanceMeters(
      settings.cafeLatitude,
      settings.cafeLongitude,
      location.latitude,
      location.longitude,
    );
    const radius = settings.shiftLocationRadiusMeters;
    if (distance > radius) {
      throw new BadRequestException(`Начать смену можно только на территории заведения. Вы примерно в ${Math.round(distance)} м от кафе.`);
    }
  }

  async end(waiterId: string) {
    const shift = await this.prisma.$transaction(async (tx) => {
      const active = await this.current(waiterId, tx);
      if (!active) {
        throw new BadRequestException('Смена не начата.');
      }

      const activeOrders = await tx.order.count({
        where: {
          waiterId,
          status: { notIn: CLOSED_ORDER_STATUSES },
        },
      });
      if (activeOrders > 0) {
        throw new BadRequestException('Нельзя завершить смену, пока есть активные заказы.');
      }

      return tx.waiterShift.update({
        where: { id: active.id },
        data: {
          status: WaiterShiftStatus.closed,
          endedAt: new Date(),
        },
      });
    });

    // Итоги смены: сколько заказов официант закрыл (оплачено) и на какую сумму.
    const [ordersCount, totals] = await Promise.all([
      this.prisma.order.count({
        where: { waiterShiftId: shift.id, status: OrderStatus.paid },
      }),
      this.prisma.order.aggregate({
        where: { waiterShiftId: shift.id, status: OrderStatus.paid },
        _sum: { finalAmount: true },
      }),
    ]);
    const result = {
      ...shift,
      stats: {
        ordersCount,
        totalAmount: String(totals._sum.finalAmount ?? 0),
        activeOrdersCount: 0,
      },
    };

    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    return result;
  }
}
