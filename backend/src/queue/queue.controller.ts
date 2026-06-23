import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  /** Озвучка готового заказа для табло (WAV). order — id заказа. */
  @Public()
  @Get('announce')
  async announce(
    @Res() res: Response,
    @Query('order') order?: string,
    @Query('code') code?: string,
    @Query('cafe') cafe?: string,
  ) {
    if (!order) throw new BadRequestException('order обязателен');
    const wav = await this.queue.announce({ orderId: order, code, cafeId: cafe });
    res.setHeader('Content-Type', 'audio/wav');
    res.send(wav);
  }
}
