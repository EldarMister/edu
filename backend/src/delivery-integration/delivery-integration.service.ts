import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OrderItemStatus, OrderStatus } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { orderInclude } from '../orders/order.helpers';
import { setCafeId } from '../tenant/tenant-context';
import { assertCafeActive } from '../platform/cafe-status';
import { CreateDeliveryOrderDto } from './dto/create-delivery-order.dto';

const READY_ITEM_STATUSES = new Set<OrderItemStatus>([
  OrderItemStatus.ready,
  OrderItemStatus.served,
]);

const COMPLETED_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.ready,
  OrderStatus.picked_up,
  OrderStatus.served,
  OrderStatus.waiting_payment,
  OrderStatus.paid,
]);

@Injectable()
export class DeliveryIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  /** Проверяет ключ, активность модуля и устанавливает tenant-контекст запроса. */
  async authenticate(apiKey: string) {
    const suppliedHash = createHash('sha256').update(apiKey).digest('hex');
    const settings = await this.prisma.settings.findFirst({
      where: { deliveryApiKeyHash: suppliedHash, deliveryEnabled: true },
      select: { cafeId: true, deliveryApiKeyHash: true },
    });
    if (!settings?.cafeId || !settings.deliveryApiKeyHash) {
      throw new UnauthorizedException('Неверный или отключённый API-ключ');
    }

    // Запрос выше уже ищет точное значение; constant-time сравнение оставляем как
    // дополнительную защиту на случай будущей смены способа поиска ключа.
    const expected = Buffer.from(settings.deliveryApiKeyHash, 'hex');
    const supplied = Buffer.from(suppliedHash, 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException('Неверный или отключённый API-ключ');
    }

    await assertCafeActive(this.prisma, settings.cafeId);
    setCafeId(settings.cafeId);
  }

  async createOrder(dto: CreateDeliveryOrderDto) {
    const order = await this.orders.createFromDelivery(dto);
    return this.toExternalOrder(order);
  }

  async getOrder(externalOrderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { source: 'delivery', externalOrderId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Заказ доставки не найден');
    return this.toExternalOrder(order);
  }

  /** Меню с POS-id: внешний клиент обязан отправлять именно эти dishId/variantId. */
  async getMenu() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        prepStation: true,
        dishes: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            discountType: true,
            discountValue: true,
            isAvailable: true,
            isSet: true,
            isWeighted: true,
            weightedMeasure: true,
            weightedPriceBase: true,
            prepStation: true,
            updatedAt: true,
            variants: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, name: true, price: true, sortOrder: true },
            },
            setComponents: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                quantity: true,
                removable: true,
                replaceable: true,
                dishVariantId: true,
                dish: { select: { id: true, name: true, price: true, isAvailable: true } },
                dishVariant: { select: { id: true, name: true, price: true } },
              },
            },
          },
        },
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      categories: categories.map((category) => ({
        ...category,
        dishes: category.dishes.map((dish) => ({
          ...dish,
          price: String(dish.price),
          discountValue: String(dish.discountValue),
          variants: dish.variants.map((variant) => ({ ...variant, price: String(variant.price) })),
          setComponents: dish.setComponents.map((component) => ({
            ...component,
            dish: { ...component.dish, price: String(component.dish.price) },
            dishVariant: component.dishVariant
              ? { ...component.dishVariant, price: String(component.dishVariant.price) }
              : null,
          })),
        })),
      })),
    };
  }

  async getStopList() {
    const dishes = await this.prisma.dish.findMany({
      where: { isActive: true, isAvailable: false },
      orderBy: { name: 'asc' },
      select: { id: true, categoryId: true, name: true, updatedAt: true },
    });
    return { generatedAt: new Date().toISOString(), dishes };
  }

  private toExternalOrder(order: Awaited<ReturnType<OrdersService['findById']>>) {
    let itemsTotal = 0;
    let itemsReady = 0;
    let itemsRejected = 0;
    for (const item of order.items) {
      itemsTotal += item.quantity;
      if (READY_ITEM_STATUSES.has(item.status)) itemsReady += item.quantity;
      if (item.status === OrderItemStatus.rejected || item.status === OrderItemStatus.cancelled) {
        itemsRejected += item.quantity;
      }
    }

    return {
      id: order.id,
      externalOrderId: order.externalOrderId,
      orderNumber: order.orderNumber,
      source: order.source,
      status: order.status,
      completed: COMPLETED_ORDER_STATUSES.has(order.status),
      customer: {
        name: order.deliveryCustomerName,
        phone: order.deliveryCustomerPhone,
        address: order.deliveryAddress,
      },
      comment: order.comment,
      totals: {
        total: String(order.totalAmount),
        discount: String(order.discountAmount),
        final: String(order.finalAmount),
      },
      progress: { itemsTotal, itemsReady, itemsRejected },
      items: order.items.map((item) => ({
        id: item.id,
        dishId: item.dishId,
        variantId: item.dishVariantId,
        name: item.dishNameSnapshot,
        variantName: item.dishVariantNameSnapshot,
        quantity: item.quantity,
        readyQuantity: READY_ITEM_STATUSES.has(item.status) ? item.quantity : 0,
        status: item.status,
        rejectReason: item.rejectReason,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
