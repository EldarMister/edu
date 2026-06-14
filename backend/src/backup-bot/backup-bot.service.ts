import { Injectable, Logger } from '@nestjs/common';
import type { TelegramMessage } from './backup-bot.types';

@Injectable()
export class BackupBotService {
  private readonly logger = new Logger(BackupBotService.name);

  isAllowedChat(chatId: number) {
    const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;
    if (!allowed) return false;
    return allowed
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(String(chatId));
  }

  isBackupCommand(text: string) {
    const command = text.trim().split(/\s+/)[0]?.toLowerCase();
    return command === '/backup' || command.startsWith('/backup@');
  }

  async handleBackupCommand(message: TelegramMessage) {
    if (!this.isAllowedChat(message.chat.id)) {
      this.logger.warn(`Rejected backup command from unauthorized chat ${message.chat.id}`);
      await this.sendTelegramMessage(message.chat.id, 'Нет доступа к запуску бэкапа.');
      return;
    }

    await this.triggerGithubBackupWorkflow();
    await this.sendTelegramMessage(
      message.chat.id,
      'Запустил backup workflow. Статус смотри в GitHub Actions: Backup production database.',
    );
  }

  private async triggerGithubBackupWorkflow() {
    const token = this.requiredEnv('GITHUB_BACKUP_DISPATCH_TOKEN');
    const repo = process.env.GITHUB_BACKUP_REPO ?? 'EldarMister/edu';
    const workflowId = process.env.GITHUB_BACKUP_WORKFLOW_ID ?? 'backup-prod-db.yml';
    const ref = process.env.GITHUB_BACKUP_REF ?? 'main';

    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ ref }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub workflow dispatch failed: HTTP ${response.status} ${text}`);
    }

    this.logger.log(`Backup workflow dispatched for ${repo}/${workflowId} on ${ref}`);
  }

  async sendTelegramMessage(chatId: number, text: string) {
    const token = this.requiredEnv('TELEGRAM_BOT_TOKEN');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(`Telegram sendMessage failed: HTTP ${response.status} ${body}`);
    }
  }

  private requiredEnv(name: string) {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  }
}
