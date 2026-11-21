import { Logger } from '@nestjs/common';
import type {
  FiscalReceiptData,
  FiscalResult,
  IFiscalProvider,
} from '../fiscal.interface';

/** Локальная проверка печати тестового чека. */
export class MockFiscalProvider implements IFiscalProvider {
  private readonly logger = new Logger(MockFiscalProvider.name);

  async printReceipt(data: FiscalReceiptData): Promise<FiscalResult> {
    const fiscalReceiptNumber = `MOCK-${data.orderId.slice(0, 8)}`;
    this.logger.log(
      `Эмуляция фискального чека заказа ${data.orderNumber}: №${fiscalReceiptNumber}, сумма ${data.totalAmount}, секция ${data.section ?? '-'}.`,
    );
    return {
      success: true,
      simulated: true,
      fiscalReceiptNumber,
    };
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}
