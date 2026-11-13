import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { IngredientsService } from './ingredients.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CreateIngredientDto, UpdateIngredientDto } from './dto';
import { assertWarehousePermission } from './warehouse-permissions';

@Controller('admin/warehouse/ingredients')
@Roles(Role.ADMIN, Role.OWNER, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  @Get('overview')
  overview(@Query('warehouseId') warehouseId?: string) {
    return this.ingredients.overview(warehouseId);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.ingredients.findAll({
      search,
      warehouseId,
      includeInactive: includeInactive === 'true' || includeInactive === '1',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.ingredients.findOne(id); }

  @Post()
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseReceive')
  create(@Body() dto: CreateIngredientDto, @CurrentUser() actor: AuthUser) {
    if (dto.stock) assertWarehousePermission(actor, 'warehouseApprove');
    if (dto.avgCost) assertWarehousePermission(actor, 'warehouseCosts');
    return this.ingredients.create(dto, actor);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseSettings')
  update(@Param('id') id: string, @Body() dto: UpdateIngredientDto) {
    return this.ingredients.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseSettings')
  remove(@Param('id') id: string) {
    return this.ingredients.remove(id);
  }
}
