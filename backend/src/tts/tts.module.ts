import { Module } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { TtsKeepaliveService } from './tts-keepalive.service';
import { SileroTtsProvider } from './silero.provider';
import { TTS_PROVIDER } from './tts-provider.interface';

/**
 * TTS как отдельный модуль со слоем-обёрткой (TTS_PROVIDER).
 * Чтобы сменить движок — достаточно подменить провайдера, кухня не меняется.
 */
@Module({
  controllers: [TtsController],
  providers: [
    TtsService,
    TtsKeepaliveService,
    { provide: TTS_PROVIDER, useClass: SileroTtsProvider },
  ],
  exports: [TtsService],
})
export class TtsModule {}
