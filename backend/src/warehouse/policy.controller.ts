import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { SettingsService } from '../settings/settings.service';

class WarehousePolicyDto {
  @IsBoolean()
  allowNegativeIngredientStock: boolean;
}

@Controller('admin/warehouse/policy')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.warehouse')
export class WarehousePolicyController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get() { return this.serialize((await this.settings.ensure()).allowNegativeIngredientStock); }

  @Patch()
  @RequirePermission('actions.warehouseSettings')
  async update(@Body() dto: WarehousePolicyDto, @CurrentUser() user: AuthUser) {
    await this.settings.update({ allowNegativeIngredientStock: dto.allowNegativeIngredientStock }, user);
    return this.serialize(dto.allowNegativeIngredientStock);
  }

  private serialize(allowNegativeIngredientStock: boolean) {
    return { allowNegativeIngredientStock,
      warning: 'Отрицательные остатки делают оценку стоимости предварительной. Вовремя оформляйте приходы и проверяйте расхождения.',
      valuationRule: 'Расход в минус оценивается по последней средней стоимости на выбранном складе. При следующем приходе отрицательное количество не участвует в усреднении, разница фиксируется как корректировка оценки в журнале. Исторические списания не пересчитываются.',
    };
  }
}
