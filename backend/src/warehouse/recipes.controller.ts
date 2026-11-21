import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RecipesService } from './recipes.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { RecipeDraftDto, RecipeItemInputDto, RecipeItemUpdateDto, RecipeSettingsDto } from './recipes.dto';

@Controller('admin/warehouse')
@Roles(Role.ADMIN, Role.OWNER, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get('dishes')
  listDishes(@Query('search') search?: string) { return this.recipes.listDishes(search); }

  @Get('dishes/:dishId/recipe-draft')
  getDraft(@Param('dishId') dishId: string) { return this.recipes.getDraft(dishId); }

  @Put('dishes/:dishId/recipe-draft')
  @RequirePermission('actions.warehouseRecipes')
  saveDraft(@Param('dishId') dishId: string, @Body() dto: RecipeDraftDto) { return this.recipes.saveDraft(dishId, dto); }

  @Get('dishes/:dishId/recipe')
  getByDish(@Param('dishId') dishId: string, @Query('variantId') variantId?: string) {
    return this.recipes.getByDish(dishId, variantId);
  }

  @Post('dishes/:dishId/recipe')
  @RequirePermission('actions.warehouseRecipes')
  addItem(@Param('dishId') dishId: string, @Body() dto: RecipeItemInputDto) {
    return this.recipes.addItem(dishId, dto);
  }

  @Patch('recipe/:id')
  @RequirePermission('actions.warehouseRecipes')
  updateItem(@Param('id') id: string, @Body() dto: RecipeItemUpdateDto) {
    return this.recipes.updateItem(id, dto);
  }

  @Delete('recipe/:id')
  @RequirePermission('actions.warehouseRecipes')
  removeItem(@Param('id') id: string) {
    return this.recipes.removeItem(id);
  }

  @Patch('dishes/:dishId/recipe-settings')
  @RequirePermission('actions.warehouseRecipes')
  updateSettings(@Param('dishId') dishId: string, @Body() dto: RecipeSettingsDto) {
    return this.recipes.updateSettings(dishId, dto);
  }

  @Get('dishes/:dishId/recipe-revisions')
  revisions(@Param('dishId') dishId: string) {
    return this.recipes.revisions(dishId);
  }
}
