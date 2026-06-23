import { Controller, Get } from '@nestjs/common';
import { QueueService } from './queue.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  /** Публичное табло очереди заказов (висит на мониторе в зале, без входа). */
  @Public()
  @Get()
  board() {
    return this.queue.getBoard();
  }
}
