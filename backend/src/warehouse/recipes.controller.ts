import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RecipesService } from './recipes.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateRecipeItemDto, UpdateRecipeItemDto } from './dto';

@Controller('admin/warehouse')
@Roles(Role.ADMIN, Role.OWNER)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get('dishes/:dishId/recipe')
  getByDish(@Param('dishId') dishId: string) {
    return this.recipes.getByDish(dishId);
  }

  @Post('dishes/:dishId/recipe')
  addItem(@Param('dishId') dishId: string, @Body() dto: CreateRecipeItemDto) {
    return this.recipes.addItem(dishId, dto);
  }

  @Patch('recipe/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateRecipeItemDto) {
    return this.recipes.updateItem(id, dto);
  }

  @Delete('recipe/:id')
  removeItem(@Param('id') id: string) {
    return this.recipes.removeItem(id);
  }
}
