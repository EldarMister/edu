import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { MonitoringCronService } from './monitoring-cron.service';

@Module({
  controllers: [HealthController, TelegramController],
  providers: [HealthService, TelegramService, MonitoringCronService],
  exports: [HealthService, TelegramService],
})
export class MonitoringModule {}
