import { Injectable, Logger } from '@nestjs/common';
import { HealthService } from './health.service';

interface TelegramMessage {
  chat?: { id?: number | string };
  text?: string;
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly health: HealthService) {}

  configured() {
    return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
  }

  async sendAlert(text: string) {
    if (!this.configured()) return;
    await this.sendMessage(process.env.TELEGRAM_CHAT_ID!, text);
  }

  async handleWebhook(secret: string, update: TelegramUpdate) {
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return { ok: false };
    }

    const message = update.message ?? update.edited_message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim() ?? '';
    if (!chatId || !text) return { ok: true };
    if (!this.isAllowedChat(chatId)) return { ok: true };

    const command = text.split(/\s+/)[0].replace(/@\w+$/, '').toLowerCase();
    const reply = await this.replyFor(command);
    await this.sendMessage(String(chatId), reply);
    return { ok: true };
  }

  private async replyFor(command: string) {
    if (command === '/status') return this.health.statusText('project');
    if (command === '/dev') return this.health.statusText('dev');
    if (command === '/main' || command === '/prod') return this.health.statusText('main');
    if (command === '/migrations') return this.health.statusText('migrations');
    if (command === '/help' || command === '/start') {
      return [
        'EDU POS monitor',
        '/status - общий статус проекта',
        '/dev - dev база и миграции',
        '/main - main/prod база и миграции',
        '/migrations - миграции текущего backend',
      ].join('\n');
    }
    return 'Неизвестная команда. Используй /status, /dev, /main, /migrations.';
  }

  private isAllowedChat(chatId: number | string) {
    const configured = process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '';
    const allowed = configured.split(',').map((id) => id.trim()).filter(Boolean);
    return allowed.length === 0 || allowed.includes(String(chatId));
  }

  private async sendMessage(chatId: string, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
      if (!response.ok) {
        this.logger.warn(`Telegram send failed: ${response.status} ${await response.text()}`);
      }
    } catch (err) {
      this.logger.warn(`Telegram send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
