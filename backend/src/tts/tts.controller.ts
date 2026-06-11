import { Body, Controller, Get, HttpException, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { TtsService } from './tts.service';
import { SynthesizeDto } from './dto/synthesize.dto';

/** Озвучка кухни. Текст формирует backend, аудио отдаёт self-hosted Silero. */
@Controller('tts')
@Roles(Role.KITCHEN, Role.BAR, Role.WAITER, Role.ADMIN, Role.OWNER)
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Get('health')
  health() {
    return { configured: this.tts.isConfigured() };
  }

  @Post('synthesize')
  async synthesize(@Body() dto: SynthesizeDto, @Res() res: Response) {
    try {
      const wav = await this.tts.synthesize(dto.text);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(wav);
    } catch (err) {
      // Сервис недоступен — кухня продолжает работать без озвучки (без Web Speech).
      throw new HttpException(
        (err as Error)?.message ?? 'TTS недоступен',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
