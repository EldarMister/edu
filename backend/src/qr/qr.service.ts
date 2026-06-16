import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { DishesService } from '../dishes/dishes.service';
import { CategoriesService } from '../categories/categories.service';
import { OrdersService } from '../orders/orders.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import type { AddItemDto, UpdateItemDto } from './dto';

const sessionInclude = {
  guests: { orderBy: { createdAt: 'asc' as const } },
  items: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.QrTableSessionInclude;

type SessionWithRelations = Prisma.QrTableSessionGetPayload<{ include: typeof sessionInclude }>;

/**
 * Публичное QR-меню стола: общий заказ, который гости наполняют со своих телефонов.
 * Без авторизации — гость идентифицируется секретом guestKey (localStorage).
 * Realtime для гостей одного стола идёт в комнату qr-table:{tableId}.
 */
@Injectable()
export class QrService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private dishes: DishesService,
    private categories: CategoriesService,
    private orders: OrdersService,
    private events: EventsGateway,
  ) {}

  /** Стол по неугадываемому токену из QR-ссылки. */
  private async resolveTable(tableToken: string) {
    const table = await this.prisma.table.findUnique({
      where: { qrToken: tableToken },
      select: { id: true, number: true, isActive: true, hall: { select: { name: true } } },
    });
    if (!table || !table.isActive) {
      throw new NotFoundException('Стол не найден или недоступен');
    }
    return table;
  }

  /** Меню для гостя: реквизиты заведения, стол, категории и блюда. */
  async getMenu(tableToken: string) {
    const table = await this.resolveTable(tableToken);
    const [settings, categories, dishes] = await Promise.all([
      this.settings.getPublic(),
      this.categories.findAll(),
      this.dishes.findAll({}),
    ]);
    return {
      cafe: {
        name: settings.cafeName,
        address: settings.address,
        phone: settings.phone,
      },
      table: { id: table.id, number: table.number, hall: table.hall?.name ?? null },
      categories,
      dishes,
    };
  }

  /** Активная (draft) сессия стола с гостями и позициями — или null, если её нет. */
  async getSession(tableToken: string) {
    const table = await this.resolveTable(tableToken);
    const session = await this.prisma.qrTableSession.findFirst({
      where: { tableId: table.id, status: 'draft' },
      orderBy: { createdAt: 'desc' },
      include: sessionInclude,
    });
    return this.serializeSession(table, session);
  }

  /** Вход гостя: создаёт/возвращает сессию и гостя (Гость N). */
  async join(tableToken: string, guestKey?: string) {
    const table = await this.resolveTable(tableToken);
    const session = await this.getOrCreateDraftSession(table.id);

    const key = guestKey?.trim() || randomUUID();
    let guest = await this.prisma.qrGuest.findUnique({
      where: { sessionId_guestKey: { sessionId: session.id, guestKey: key } },
    });
    if (!guest) {
      const count = await this.prisma.qrGuest.count({ where: { sessionId: session.id } });
      guest = await this.prisma.qrGuest.create({
        data: {
          sessionId: session.id,
          guestKey: key,
          guestLabel: `Гость ${count + 1}`,
          isOnline: true,
        },
      });
    } else {
      guest = await this.prisma.qrGuest.update({
        where: { id: guest.id },
        data: { isOnline: true, lastSeenAt: new Date() },
      });
    }

    this.events.emitToQrTable(table.id, SERVER_EVENTS.QR_GUEST_JOINED, {
      tableId: table.id,
      guestId: guest.id,
      guestLabel: guest.guestLabel,
    });

    return {
      sessionId: session.id,
      guestId: guest.id,
      guestKey: key,
      guestLabel: guest.guestLabel,
      tableId: table.id,
    };
  }

  /** Гость добавляет позицию в общий заказ. */
  async addItem(tableToken: string, dto: AddItemDto) {
    const table = await this.resolveTable(tableToken);
    const { session, guest } = await this.requireGuest(table.id, dto.guestKey);

    const dish = await this.prisma.dish.findFirst({
      where: { id: dto.dishId, isActive: true },
      select: { id: true, name: true, price: true, _count: { select: { variants: true } } },
    });
    if (!dish) throw new NotFoundException('Блюдо не найдено');

    let variantName: string | null = null;
    let price = dish.price;
    if (dto.variantId) {
      const variant = await this.prisma.dishVariant.findFirst({
        where: { id: dto.variantId, dishId: dish.id },
        select: { name: true, price: true },
      });
      if (!variant) throw new NotFoundException('Вариант блюда не найден');
      variantName = variant.name;
      price = variant.price;
    } else if (dish._count.variants > 0) {
      // Блюдо с вариантами нельзя добавить без выбора варианта (модалка это требует).
      throw new BadRequestException(`Выберите вариант блюда «${dish.name}»`);
    }

    await this.prisma.qrSessionItem.create({
      data: {
        sessionId: session.id,
        guestId: guest.id,
        dishId: dish.id,
        variantId: dto.variantId ?? null,
        quantity: dto.quantity,
        snapshotName: dish.name,
        variantName,
        snapshotPrice: price,
        comment: dto.comment ?? null,
      },
    });

    return this.emitAndReturn(table, SERVER_EVENTS.QR_ITEM_ADDED);
  }

  /** Гость меняет количество своей позиции. */
  async updateItem(tableToken: string, itemId: string, dto: UpdateItemDto) {
    const table = await this.resolveTable(tableToken);
    const { guest } = await this.requireGuest(table.id, dto.guestKey);
    const item = await this.requireOwnItem(itemId, guest.id);

    await this.prisma.qrSessionItem.update({
      where: { id: item.id },
      data: { quantity: dto.quantity ?? item.quantity },
    });

    return this.emitAndReturn(table, SERVER_EVENTS.QR_ITEM_UPDATED);
  }

  /** Гость удаляет свою позицию. */
  async removeItem(tableToken: string, itemId: string, guestKey: string) {
    const table = await this.resolveTable(tableToken);
    const { guest } = await this.requireGuest(table.id, guestKey);
    const item = await this.requireOwnItem(itemId, guest.id);

    await this.prisma.qrSessionItem.delete({ where: { id: item.id } });

    return this.emitAndReturn(table, SERVER_EVENTS.QR_ITEM_REMOVED);
  }

  /** Отправка общего заказа стола в POS (создаёт реальный заказ source=qr). */
  async submit(tableToken: string, guestKey: string) {
    const table = await this.resolveTable(tableToken);
    const { session } = await this.requireGuest(table.id, guestKey);

    const full = await this.prisma.qrTableSession.findUniqueOrThrow({
      where: { id: session.id },
      include: sessionInclude,
    });
    const orderable = full.items.filter((i) => !!i.dishId);
    if (orderable.length === 0) {
      throw new BadRequestException('Общий заказ пуст');
    }

    const guestLabelById = new Map(full.guests.map((g) => [g.id, g.guestLabel]));
    const items = orderable.map((i) => {
      const label = guestLabelById.get(i.guestId) ?? 'Гость';
      // Сохраняем «кто добавил» в комментарии позиции (без изменения схемы заказа).
      const comment = i.comment ? `${label} · ${i.comment}` : label;
      return {
        dishId: i.dishId as string,
        variantId: i.variantId ?? undefined,
        quantity: i.quantity,
        comment,
      };
    });

    const order = await this.orders.createFromQr({ tableId: table.id, items, comment: 'Заказ из QR-меню' });

    await this.prisma.qrTableSession.update({
      where: { id: session.id },
      data: { status: 'submitted', submittedOrderId: order.id },
    });

    this.events.emitToQrTable(table.id, SERVER_EVENTS.QR_ORDER_SUBMITTED, {
      tableId: table.id,
      sessionId: session.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableNumber: table.number,
    };
  }

  // ---- helpers ----

  private async getOrCreateDraftSession(tableId: string) {
    const existing = await this.prisma.qrTableSession.findFirst({
      where: { tableId, status: 'draft' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;
    return this.prisma.qrTableSession.create({ data: { tableId, status: 'draft' } });
  }

  /** Находит активную сессию и гостя по guestKey; иначе — ошибка. */
  private async requireGuest(tableId: string, guestKey: string) {
    const session = await this.prisma.qrTableSession.findFirst({
      where: { tableId, status: 'draft' },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) throw new BadRequestException('Сессия заказа не найдена. Откройте меню заново.');
    const guest = await this.prisma.qrGuest.findUnique({
      where: { sessionId_guestKey: { sessionId: session.id, guestKey } },
    });
    if (!guest) throw new ForbiddenException('Гость не найден в этой сессии');
    return { session, guest };
  }

  /** Позиция должна принадлежать гостю — иначе нельзя редактировать. */
  private async requireOwnItem(itemId: string, guestId: string) {
    const item = await this.prisma.qrSessionItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Позиция не найдена');
    if (item.guestId !== guestId) {
      throw new ForbiddenException('Можно изменять только свои позиции');
    }
    return item;
  }

  /** Перечитывает сессию, шлёт realtime и возвращает сериализованный заказ. */
  private async emitAndReturn(
    table: { id: string; number: number; hall: { name: string } | null },
    event: string,
  ) {
    const session = await this.prisma.qrTableSession.findFirst({
      where: { tableId: table.id, status: 'draft' },
      orderBy: { createdAt: 'desc' },
      include: sessionInclude,
    });
    const payload = this.serializeSession(table, session);
    this.events.emitToQrTable(table.id, event, { tableId: table.id });
    this.events.emitToQrTable(table.id, SERVER_EVENTS.QR_CART_UPDATED, payload);
    return payload;
  }

  private serializeSession(
    table: { id: string; number: number; hall: { name: string } | null },
    session: SessionWithRelations | null,
  ) {
    if (!session) {
      return {
        sessionId: null,
        status: 'draft',
        table: { id: table.id, number: table.number, hall: table.hall?.name ?? null },
        guests: [],
        items: [],
        itemCount: 0,
        totalAmount: '0',
        submittedOrderId: null,
      };
    }

    const labelById = new Map(session.guests.map((g) => [g.id, g.guestLabel]));
    let total = 0;
    let count = 0;
    const items = session.items.map((i) => {
      const line = Number(i.snapshotPrice) * i.quantity;
      total += line;
      count += i.quantity;
      return {
        id: i.id,
        guestId: i.guestId,
        guestLabel: labelById.get(i.guestId) ?? 'Гость',
        dishId: i.dishId,
        variantId: i.variantId,
        name: i.snapshotName,
        variantName: i.variantName,
        quantity: i.quantity,
        price: String(i.snapshotPrice),
        lineTotal: String(round2(line)),
        comment: i.comment,
      };
    });

    return {
      sessionId: session.id,
      status: session.status,
      table: { id: table.id, number: table.number, hall: table.hall?.name ?? null },
      guests: session.guests.map((g) => ({
        id: g.id,
        guestLabel: g.guestLabel,
        isOnline: g.isOnline,
      })),
      items,
      itemCount: count,
      totalAmount: String(round2(total)),
      submittedOrderId: session.submittedOrderId,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
