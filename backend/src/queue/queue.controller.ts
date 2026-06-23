import { Controller, Get, Query } from '@nestjs/common';
import { QueueService } from './queue.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  /** Публичное табло очереди заказов (висит на мониторе в зале, без входа).
   *  cafe — идентификатор кафе из ссылки (для мультитенантности). */
  @Public()
  @Get()
  board(@Query('cafe') cafe?: string) {
    return this.queue.getBoard(cafe);
  }
}
