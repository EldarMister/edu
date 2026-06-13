import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HealthService } from './health.service';
import { TelegramService } from './telegram.service';

@Injectable()
export class MonitoringCronService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringCronService.name);
  private lastProblem = false;

  constructor(
    private readonly health: HealthService,
    private readonly telegram: TelegramService,
  ) {}

  onModuleInit() {
    setTimeout(() => void this.check('startup'), 5000);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledCheck() {
    await this.check('cron');
  }

  private async check(reason: 'startup' | 'cron') {
    try {
      const hasProblem = await this.health.hasProblem();
      if (hasProblem && !this.lastProblem) {
        await this.telegram.sendAlert(`EDU POS alert (${reason})\n\n${await this.health.statusText('project')}`);
      }
      if (!hasProblem && this.lastProblem) {
        await this.telegram.sendAlert(`EDU POS recovered\n\n${await this.health.statusText('project')}`);
      }
      this.lastProblem = hasProblem;
    } catch (err) {
      this.logger.warn(`Monitoring check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
