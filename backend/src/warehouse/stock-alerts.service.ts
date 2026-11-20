import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../tenant/tenant-context';
import { warehouseBalances } from './warehouse-location';
import { fromBase, normalizeUnit, unitLabel } from './units';

const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const maxAlertLines = 18;

@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 */5 * * * *', { waitForCompletion: true })
  async checkStock() {
    const token = process.env.TELEGRAM_STOCK_BOT_TOKEN?.trim();
    if (!token) return;
    const destinations = await this.prisma.settings.findMany({
      where: { cafeId: { not: null }, telegramStockAlertsEnabled: true, telegramStockChatId: { not: null } },
      select: { id: true, cafeId: true },
    });
    for (const { id, cafeId } of destinations) {
      if (!cafeId) continue;
      try {
        await runWithTenant({ cafeId }, () => this.checkCafe(id, token));
      } catch {
        this.logger.warn(`Не удалось обработать оповещения об остатках для заведения ${cafeId}`);
      }
    }
  }

  private checkCafe(settingsId: string, token: string) {
    return this.prisma.$transaction(async (tx) => {
      // A restaurant can be processed by more than one running instance.
      const lock = `telegram-stock-alerts:${settingsId}`;
      const [lease] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${lock})) AS acquired
      `;
      if (!lease?.acquired) return;
      const settings = await tx.settings.findUnique({
        where: { id: settingsId },
        select: { cafeName: true, telegramStockChatId: true, telegramStockAlertsEnabled: true, telegramStockAlertState: true },
      });
      const chatId = settings?.telegramStockChatId;
      if (!chatId || !settings.telegramStockAlertsEnabled) return;

      const ingredients = await tx.ingredient.findMany({
        where: { isActive: true, preparationMode: { not: 'virtual' }, lowStockThreshold: { gt: 0 } },
        select: { id: true, name: true, displayUnit: true, stock: true, avgCost: true, valuationKnown: true, lowStockThreshold: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      const balances = await warehouseBalances(tx, null, ingredients);
      const low = ingredients.filter((item) => balances.get(item.id)!.stock.lte(item.lowStockThreshold));
      const previous = new Set(Array.isArray(settings.telegramStockAlertState) ? settings.telegramStockAlertState : []);
      const pending = low.filter((item) => !previous.has(item.id));
      if (!pending.length && low.length === previous.size) return;

      if (pending.length) {
        const lines = pending.slice(0, maxAlertLines).map((item) => {
          const unit = normalizeUnit(item.displayUnit);
          const amount = formatter.format(fromBase(Number(balances.get(item.id)!.stock), unit));
          const limit = formatter.format(fromBase(Number(item.lowStockThreshold), unit));
          const name = item.name.replace(/\s+/g, ' ').slice(0, 112);
          return `• ${name} — ${amount} ${unitLabel(unit)} (лимит ${limit})`;
        });
        const hidden = pending.length - lines.length;
        if (hidden > 0) lines.push(`Ещё позиций ниже лимита: ${hidden}`);
        await this.send(token, chatId, [settings.cafeName, 'Остатки достигли лимита', ...lines].join('\n'));
      }
      await tx.settings.updateMany({
        where: { id: settingsId, telegramStockChatId: chatId, telegramStockAlertsEnabled: true },
        data: { telegramStockAlertState: low.map(({ id }) => id) },
      });
    }, { timeout: 20_000 });
  }

  private async send(token: string, chatId: string, text: string) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(chatId), text }),
      signal: AbortSignal.timeout(8_000),
    });
    const result = await response.json() as { ok?: boolean };
    if (!response.ok || result.ok !== true) throw new Error('Telegram отклонил оповещение');
  }
}
