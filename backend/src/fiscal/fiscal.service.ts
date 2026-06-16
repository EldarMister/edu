import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Settings } from '@prisma/client';
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
import { EkassaProvider } from './providers/ekassa.provider';
import { YakassaProvider } from './providers/yakassa.provider';
import { MockFiscalProvider } from './providers/mock.provider';

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
    switch (s.fiscalProvider) {
      case 'mock':
        // Эмуляция для проверки интеграции без реального ключа ККМ.
        return new MockFiscalProvider();
      case 'ekassa':
        return new EkassaProvider({
          apiKey: s.fiscalEkassaApiKey,
          url: s.fiscalEkassaUrl,
          inn: s.fiscalEkassaInn,
        });
      case 'yakassa':
        return new YakassaProvider({
          apiKey: s.fiscalYakassaApiKey,
          url: s.fiscalYakassaUrl,
        });
      default:
        return null;
    }
  }

  /** Провайдер или ошибка — для явных действий (проверка соединения, ручной повтор). */
  private async requireProvider(): Promise<IFiscalProvider> {
    const provider = this.resolveProvider(await this.settings.get());
    if (!provider) {
      throw new BadRequestException(
        'Провайдер ККМ не настроен. Выберите eKassa или YaKassa в настройках.',
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
   * @param force — повторить даже если уже была ошибка (используется кнопкой «Повторить»).
   */
  async fiscalizeOrder(orderId: string, force = false): Promise<FiscalResult | null> {
    const settings = await this.settings.get();
    const provider = this.resolveProvider(settings);
    if (!provider) return null; // ККМ выключена — no-op

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    // Уже успешно пробит — не дублируем.
    if (order.fiscalReceiptNumber && !force) {
      return {
        success: true,
        fiscalReceiptNumber: order.fiscalReceiptNumber,
        fiscalSign: order.fiscalSign ?? undefined,
        qrCode: order.fiscalQrCode ?? undefined,
      };
    }

    const paymentType = this.mapPaymentType(order.paymentMethod);
    const cashAmount = order.payments
      .filter((p) => p.method === PaymentMethod.cash)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const data: FiscalReceiptData = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      items: order.items.map((i) => ({
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

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        fiscalReceiptNumber: result.fiscalReceiptNumber ?? null,
        fiscalSign: result.fiscalSign ?? null,
        fiscalQrCode: result.qrCode ?? null,
        fiscalError: result.success ? null : result.error ?? 'Ошибка ККМ',
        fiscalizedAt: result.success ? new Date() : null,
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
