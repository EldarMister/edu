import { Body, Controller, ForbiddenException, HttpCode, Post, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { hasPermission, resolvePermissions } from '../common/permissions';
import { PreparationProductionService } from './preparation-production';
import { type RecipeExportKind, writeRecipeWorkbook } from './recipe-export-workbook';
import { RecipesService } from './recipes.service';

export class RecipeExportDto {
  @IsIn(['recipes', 'preparations']) kind: RecipeExportKind;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(160, { each: true })
  ids: string[];
  @IsBoolean() includeComposition: boolean;
}

@Controller('admin/warehouse')
@Roles(Role.OWNER, Role.ADMIN, Role.KITCHEN, Role.BAR)
export class RecipeExportController {
  constructor(private readonly recipes: RecipesService, private readonly preparations: PreparationProductionService) {}

  @Post('recipe-export.xlsx')
  @HttpCode(200)
  @RequirePermission('actions.exportReports')
  async exportRecipes(@Body() dto: RecipeExportDto, @CurrentUser() user: AuthUser, @Res() response: Response) {
    // Like recipe preview, the POST accepts a list without changing any records.
    const permissions = user.permissions ?? resolvePermissions(user.role as Role, null);
    if (user.role !== Role.OWNER && !['sections.menu', 'sections.warehouse'].every((section) => hasPermission(permissions, section))) {
      throw new ForbiddenException('У вас нет доступа к выгрузке меню и состава');
    }
    const showCosts = user.role === Role.OWNER || hasPermission(permissions, 'actions.warehouseCosts');
    const cards = dto.kind === 'recipes' ? await this.recipes.exportCards(dto.ids, dto.includeComposition)
      : await this.preparations.exportCards(dto.ids, dto.includeComposition);
    const workbook = writeRecipeWorkbook(cards, dto.kind, dto.includeComposition, showCosts);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${dto.kind}.xlsx"`);
    response.send(workbook);
  }
}
