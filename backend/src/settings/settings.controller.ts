import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { UpdateSettingsDto } from './dto';

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Публичные настройки — для всех ролей (экран оплаты, чек). */
  @Get('settings')
  getPublic() {
    return this.settings.getPublic();
  }

  /** QR-код как картинка с долгим кэшем (URL версионируется по updatedAt). */
  @Public()
  @Get('settings/qr')
  async qrImage(@Res() res: Response) {
    const img = await this.settings.getQrImage();
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(img.buffer);
  }

  /** Полные настройки — только владелец. */
  @Get('admin/settings')
  @Roles(Role.OWNER)
  get() {
    return this.settings.get();
  }

  @Patch('admin/settings')
  @Roles(Role.OWNER)
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser) {
    return this.settings.update(dto, user);
  }
}
