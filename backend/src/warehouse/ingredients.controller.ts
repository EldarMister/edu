import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'node:path';
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
import { BalanceExportQuery, BalanceListQuery } from './balance-xlsx';
import { IngredientImportDto } from './ingredient-import';
import { readImportSpreadsheet } from './read-import-spreadsheet';

class IngredientCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;
}

class RenameIngredientCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  from: string;
  @IsString() @IsNotEmpty() @MaxLength(120)
  to: string;
}

class IngredientSuppliesQuery {
  @IsOptional() @IsString() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsString() @MaxLength(8192)
  warehouseIds?: string;

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

  @Post('import/read')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseReceive')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } }))
  importFile(@UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    if (!file) throw new BadRequestException('Выберите таблицу ингредиентов.');
    try {
      const sheets = readImportSpreadsheet(file.buffer, extname(file.originalname).toLowerCase());
      if (sheets.length !== 1) throw new Error('Оставьте один видимый лист с ингредиентами.');
      const [headings, ...rows] = sheets[0];
      if (!headings?.length || !rows.length) throw new Error('В таблице нужны заголовки и хотя бы одна строка.');
      return { headings: headings.map(String), rows: rows.map((row) => row.map(String)) };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Не удалось прочитать таблицу.');
    }
  }

  @Post('import')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseReceive')
  importIngredients(@Body() dto: IngredientImportDto) {
    return this.ingredients.importCatalogue(dto);
  }

  @Get('categories')
  categories(@Query('includeStock') includeStock?: string) {
    return this.ingredients.categories(includeStock === 'true');
  }

  @Post('categories')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseSettings')
  createCategory(@Body() dto: IngredientCategoryDto) {
    return this.ingredients.saveCategory(dto.name);
  }

  @Post('categories/rename')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseSettings')
  renameCategory(@Body() dto: RenameIngredientCategoryDto) {
    return this.ingredients.saveCategory(dto.to, dto.from);
  }

  @Delete('categories/:name')
  @Roles(Role.ADMIN, Role.OWNER)
  @RequirePermission('actions.warehouseSettings')
  removeCategory(@Param('name') name: string, @Query('removeIngredients') removeIngredients?: string) {
    return this.ingredients.removeCategory(name, removeIngredients === 'true');
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

  @Get('balances')
  balances(@Query() query: BalanceListQuery) {
    return this.ingredients.balances(query);
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
    if (dto.stock || dto.initialSupply) assertWarehousePermission(actor, 'warehouseApprove');
    if (dto.avgCost || dto.initialSupply) assertWarehousePermission(actor, 'warehouseCosts');
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
  remove(@Param('id') id: string, @Query('scope') scope?: string) {
    return this.ingredients.remove(id, scope === 'ingredients');
  }
}
