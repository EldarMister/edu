import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { IngredientsService } from './ingredients.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CreateIngredientDto, UpdateIngredientDto } from './dto';
import { assertWarehousePermission } from './warehouse-permissions';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { BalanceExportQuery } from './balance-xlsx';

class RenameIngredientCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  from: string;
  @IsString() @IsNotEmpty() @MaxLength(120)
  to: string;
}

class IngredientSuppliesQuery {
  @IsOptional() @IsString() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

@Controller('admin/warehouse/ingredients')
@Roles(Role.ADMIN, Role.OWNER, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  @Post('categories/rename')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseSettings')
  renameCategory(@Body() dto: RenameIngredientCategoryDto) {
    return this.ingredients.renameCategory(dto.from, dto.to);
  }

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

  @Get('export.xlsx')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseCosts', 'actions.exportReports')
  async exportXlsx(@Query() query: BalanceExportQuery, @Res() response: Response) {
    const workbook = await this.ingredients.exportXlsx(query);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="warehouse-balances.xlsx"');
    response.send(workbook);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.ingredients.findOne(id); }

  @Get(':id/supplies')
  @RequirePermission('actions.warehouseReports', 'actions.warehouseCosts')
  supplies(@Param('id') id: string, @Query() query: IngredientSuppliesQuery) {
    return this.ingredients.supplies(id, query);
  }

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
