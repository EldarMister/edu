import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { PlatformSubscriptionCron } from './platform-subscription.cron';

// Платформенный слой (супер-админ) — управление кафе поверх мультитенантности.
// Секреты JWT передаём явно при sign/verify, поэтому JwtModule регистрируем пустым.
@Module({
  imports: [JwtModule.register({})],
  controllers: [PlatformAuthController, PlatformController],
  providers: [PlatformAuthService, PlatformAuthGuard, PlatformService, PlatformSubscriptionCron],
})
export class PlatformModule {}
