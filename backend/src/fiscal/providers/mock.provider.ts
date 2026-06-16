import { Logger } from '@nestjs/common';
import type {
  FiscalReceiptData,
  FiscalResult,
  IFiscalProvider,
} from '../fiscal.interface';

/**
 * Провайдер «Тест / эмуляция» — не делает сетевых запросов, а возвращает правдоподобный
 * фискальный чек (номер + признак + QR-ссылка проверки). Нужен, чтобы прогнать весь
 * сценарий фискализации и UX (карточка заказа, QR, «Повторить») без реального ключа ККМ.
 *
 * В production выбирать НЕ нужно — это инструмент проверки интеграции.
 */
export class MockFiscalProvider implements IFiscalProvider {
  private readonly logger = new Logger(MockFiscalProvider.name);

  async printReceipt(data: FiscalReceiptData): Promise<FiscalResult> {
    const seq = Date.now().toString().slice(-8);
    const fiscalReceiptNumber = `MOCK-${seq}`;
    const fiscalSign = Math.random().toString(36).slice(2, 12).toUpperCase();
    this.logger.log(
      `Эмуляция фискального чека заказа ${data.orderNumber}: №${fiscalReceiptNumber}, сумма ${data.totalAmount}, секция ${data.section ?? '-'}.`,
    );
    return {
      success: true,
      fiscalReceiptNumber,
      fiscalSign,
      // Похоже на реальную ссылку проверки чека в ГНС — фронт отрисует как ссылку.
      qrCode: `https://tax.gov.kg/check?ticket=${fiscalReceiptNumber}&sum=${data.totalAmount}`,
    };
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}
