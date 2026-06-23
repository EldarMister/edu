import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { TtsModule } from '../tts/tts.module';

@Module({
  imports: [TtsModule],
  controllers: [QueueController],
  providers: [QueueService],
})
export class QueueModule {}
