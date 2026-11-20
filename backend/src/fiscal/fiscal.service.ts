import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentMethod, Settings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import type {
  FiscalPaymentType,
  FiscalReceiptData,
  FiscalResult,
  FiscalSection,
  IFiscalProvider,
} from './fiscal.interface';
import { MockFiscalProvider } from './providers/mock.provider';

const unsupportedProvider = 'Для этой ККМ нужен подтверждённый протокол поставщика. Отправка фискальных чеков недоступна.';

/**
 * Выбирает провайдера ККМ по настройкам заведения и пробивает фискальный чек.
 *
 * Если провайдер не выбран — фискализация не выполняется (поведение системы без ККМ
 * не меняется): это и есть «NoopProvider» из ТЗ, выраженный как отсутствие провайдера.
 * Ошибка ККМ никогда не блокирует основной flow — она записывается в Order.fiscalError.
 *
 * Отклонение от ТЗ: фискальные данные хранятся на Order (а не на ReceiptPrint), т.к. в
 * edu-pos один фискальный чек логически относится к оплаченному заказу, карточка заказа
 * и кнопка «Повторить» работают per-order, и часть чеков печатается напрямую без заявки.
 */
@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: EventsGateway,
  ) {}

  /** Включена ли ККМ (выбран ли провайдер). */
  async isEnabled(): Promise<boolean> {
    const s = await this.settings.get();
    return this.resolveProvider(s) !== null;
  }

  /** Провайдер по настройкам или null, если ККМ выключена. */
  private resolveProvider(s: Settings): IFiscalProvider | null {
    // The two legacy HTTP adapters use unverified URLs and request formats.
    return s.fiscalProvider === 'mock' ? new MockFiscalProvider() : null;
  }

  /** Провайдер или ошибка — для явных действий (проверка соединения, ручной повтор). */
  private async requireProvider(): Promise<IFiscalProvider> {
    const settings = await this.settings.get();
    const provider = this.resolveProvider(settings);
    if (!provider) {
      throw new BadRequestException(
        settings.fiscalProvider ? unsupportedProvider : 'Провайдер ККМ не настроен',
      );
    }
    return provider;
  }

  /** Проверка соединения с ККМ — для кнопки «Проверить соединение». */
  async testConnection(): Promise<boolean> {
    const provider = await this.requireProvider();
    return provider.testConnection();
  }

  /**
   * Пробить фискальный чек по заказу. Идемпотентно: если чек уже успешно пробит —
   * повторно не пробивает. Безопасно вызывать из flow печати: при выключенной ККМ
   * просто возвращает null и ничего не пишет.
   *
   */
  async fiscalizeOrder(orderId: string): Promise<FiscalResult | null> {
    const settings = await this.settings.get();
    if (!settings.fiscalProvider) return null;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status !== OrderStatus.paid) throw new BadRequestException('Фискальный чек печатается по оплаченному заказу');

    // Уже успешно пробит — не дублируем.
    if (order.fiscalReceiptNumber && !order.fiscalReceiptNumber.startsWith('MOCK-')) {
      return {
        success: true,
        fiscalReceiptNumber: order.fiscalReceiptNumber,
        fiscalSign: order.fiscalSign ?? undefined,
        qrCode: order.fiscalQrCode ?? undefined,
      };
    }
    const provider = this.resolveProvider(settings);
    if (!provider) return { success: false, error: unsupportedProvider };

    const paymentType = this.mapPaymentType(order.paymentMethod);
    const cashAmount = order.payments
      .filter((p) => p.status === 'paid' && p.method === PaymentMethod.cash)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const data: FiscalReceiptData = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      items: order.items.filter((item) => item.status !== 'cancelled' && item.status !== 'rejected').map((i) => ({
        // Снимки из заказа — не из текущего блюда.
        name: i.dishVariantNameSnapshot
          ? `${i.dishNameSnapshot} (${i.dishVariantNameSnapshot})`
          : i.dishNameSnapshot,
        price: Number(i.priceSnapshot),
        quantity: i.quantity,
      })),
      totalAmount: Number(order.finalAmount),
      paymentType,
      cashAmount: cashAmount > 0 ? cashAmount : undefined,
      // Секция: 1 — наличные, 2 — безналичные. Для mixed провайдер разбивает сам.
      section: this.sectionFor(paymentType),
    };

    let result: FiscalResult;
    try {
      result = await provider.printReceipt(data);
    } catch (err) {
      // Сетевые/неожиданные ошибки тоже не должны ронять flow печати.
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка ККМ';
      this.logger.error(`Фискализация заказа ${order.orderNumber} упала: ${message}`);
      result = { success: false, error: message };
    }

    if (result.simulated) return result;
    const fiscalizedAt = result.success ? new Date() : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.order.update({
        where: { id: order.id },
        data: {
          fiscalReceiptNumber: result.fiscalReceiptNumber ?? null,
          fiscalSign: result.fiscalSign ?? null,
          fiscalQrCode: result.qrCode ?? null,
          fiscalError: result.success ? null : result.error ?? 'Ошибка ККМ',
          fiscalizedAt,
        },
        select: {
          id: true,
          fiscalReceiptNumber: true,
          fiscalSign: true,
          fiscalQrCode: true,
          fiscalError: true,
          fiscalizedAt: true,
        },
      });
      if (fiscalizedAt && order.closedAt) {
        await tx.orderTax.updateMany({
          where: { orderId: order.id, soldAt: order.closedAt, fiscalizedAt: null },
          data: { fiscalizedAt },
        });
      }
      return saved;
    });

    this.events.emitToAdmin(SERVER_EVENTS.FISCAL_RECEIPT_UPDATED, { orderId: order.id, ...updated });
    return result;
  }

  private mapPaymentType(method: PaymentMethod | null): FiscalPaymentType {
    switch (method) {
      case PaymentMethod.cash:
        return 'cash';
      case PaymentMethod.card:
        return 'card';
      case PaymentMethod.qr:
        return 'qr';
      case PaymentMethod.mixed:
        return 'mixed';
      default:
        // Нет способа оплаты — трактуем как безналичный (секция 2).
        return 'card';
    }
  }

  private sectionFor(type: FiscalPaymentType): FiscalSection {
    return type === 'cash' ? 1 : 2;
  }
}
