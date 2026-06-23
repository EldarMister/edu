import { Controller, Get, Query } from '@nestjs/common';
import { QueueService } from './queue.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  /** Публичное табло очереди заказов (висит на мониторе в зале, без входа).
   *  code — короткий код табло (/q/CODE), cafe — id кафе (обратная совместимость). */
  @Public()
  @Get()
  board(@Query('code') code?: string, @Query('cafe') cafe?: string) {
    return this.queue.getBoard({ code, cafeId: cafe });
  }
}
