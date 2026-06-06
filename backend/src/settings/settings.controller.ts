import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators/roles.decorator';
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
