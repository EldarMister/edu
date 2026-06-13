import { Body, Controller, Param, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { TelegramService, TelegramUpdate } from './telegram.service';

@Public()
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('webhook/:secret')
  webhook(@Param('secret') secret: string, @Body() body: TelegramUpdate) {
    return this.telegram.handleWebhook(secret, body);
  }
}
