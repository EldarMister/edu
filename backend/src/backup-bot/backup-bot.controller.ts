import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BackupBotService } from './backup-bot.service';
import type { TelegramUpdate } from './backup-bot.types';

@Public()
@Controller('telegram/backup')
export class BackupBotController {
  private readonly logger = new Logger(BackupBotController.name);

  constructor(private readonly backupBot: BackupBotService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ) {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret && secretToken !== expectedSecret) {
      this.logger.warn('Rejected Telegram webhook with invalid secret token');
      return { ok: true };
    }

    const message = update.message;
    const text = message?.text;
    if (!message || !text || !this.backupBot.isBackupCommand(text)) {
      return { ok: true };
    }

    try {
      await this.backupBot.handleBackupCommand(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Backup command failed: ${reason}`);
      await this.backupBot.sendTelegramMessage(message.chat.id, `Не удалось запустить бэкап: ${reason}`);
    }

    return { ok: true };
  }
}
