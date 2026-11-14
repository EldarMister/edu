import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';

class WarehousePolicyDto {
  @IsOptional() @IsBoolean()
  allowNegativeIngredientStock?: boolean;
  @IsOptional() @IsBoolean()
  warehouseProductionEnabled?: boolean;
  @IsOptional() @IsBoolean()
  warehouseProcessingEnabled?: boolean;
}

@Controller('admin/warehouse/policy')
@Roles(Role.ADMIN, Role.OWNER, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
export class WarehousePolicyController {
  constructor(private readonly settings: SettingsService, private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const settings = await this.settings.ensure();
    const cafeId = getCafeId();
    const [production, processing, stockedPreparations] = await Promise.all([
      this.prisma.preparationBatch.count({ where: { cafeId } }),
      this.prisma.processingDocument.count({ where: { cafeId } }),
      this.prisma.preparationRecipe.count({ where: { cafeId, ingredient: { isActive: true, preparationMode: 'stocked' } } }),
    ]);
    return { ...this.serialize(settings.allowNegativeIngredientStock),
      warehouseProductionEnabled: settings.warehouseProductionEnabled,
      warehouseProcessingEnabled: settings.warehouseProcessingEnabled,
      productionInUse: production > 0 || stockedPreparations > 0,
      processingInUse: processing > 0,
    };
  }

  @Patch()
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseSettings')
  async update(@Body() dto: WarehousePolicyDto, @CurrentUser() user: AuthUser) {
    await this.settings.update(dto, user);
    return this.get();
  }

  private serialize(allowNegativeIngredientStock: boolean) {
    return { allowNegativeIngredientStock,
      warning: 'Отрицательные остатки делают оценку стоимости предварительной. Вовремя оформляйте приходы и проверяйте расхождения.',
      valuationRule: 'Расход в минус оценивается по последней средней стоимости на выбранном складе. При следующем приходе отрицательное количество не участвует в усреднении, разница фиксируется как корректировка оценки в журнале. Исторические списания не пересчитываются.',
    };
  }
}
