import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IngredientsService } from './ingredients.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateIngredientDto, UpdateIngredientDto } from './dto';

@Controller('admin/warehouse/ingredients')
@Roles(Role.ADMIN, Role.OWNER)
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  @Get('overview')
  overview() {
    return this.ingredients.overview();
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.ingredients.findAll({
      search,
      includeInactive: includeInactive === 'true' || includeInactive === '1',
    });
  }

  @Post()
  create(@Body() dto: CreateIngredientDto) {
    return this.ingredients.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIngredientDto) {
    return this.ingredients.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ingredients.remove(id);
  }
}
