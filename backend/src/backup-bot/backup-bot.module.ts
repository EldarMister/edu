import { Module } from '@nestjs/common';
import { BackupBotController } from './backup-bot.controller';
import { BackupBotService } from './backup-bot.service';

@Module({
  controllers: [BackupBotController],
  providers: [BackupBotService],
})
export class BackupBotModule {}
