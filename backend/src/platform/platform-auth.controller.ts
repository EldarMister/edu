import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { CurrentPlatformAdmin } from './current-platform-admin.decorator';
import { PlatformLoginDto } from './dto';
import type { PlatformAdminInfo } from './platform-auth.service';

@Public() // пропускаем глобальные guard'ы персонала; доступ платформы — PlatformAuthGuard
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.login, dto.password);
  }

  @UseGuards(PlatformAuthGuard)
  @Get('me')
  me(@CurrentPlatformAdmin() admin: PlatformAdminInfo) {
    return admin;
  }
}
