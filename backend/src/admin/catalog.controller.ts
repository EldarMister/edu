import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateCategoryDto,
  CreateDishDto,
  CreateHallDto,
  CreateTableDto,
  UpdateCategoryDto,
  UpdateDishDto,
  UpdateHallDto,
  UpdateTableDto,
} from './dto';

@Controller('admin')
@Roles(Role.ADMIN, Role.OWNER)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ---- Залы и столы ----
  @Get('tables/overview')
  tablesOverview() {
    return this.catalog.tablesOverview();
  }

  @Get('halls')
  halls() {
    return this.catalog.hallsWithTables();
  }

  @Post('halls')
  createHall(@Body() dto: CreateHallDto) {
    return this.catalog.createHall(dto);
  }

  @Patch('halls/:id')
  updateHall(@Param('id') id: string, @Body() dto: UpdateHallDto) {
    return this.catalog.updateHall(id, dto);
  }

  @Delete('halls/:id')
  deleteHall(@Param('id') id: string) {
    return this.catalog.deleteHall(id);
  }

  @Post('tables')
  createTable(@Body() dto: CreateTableDto) {
    return this.catalog.createTable(dto);
  }

  @Patch('tables/:id')
  updateTable(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.catalog.updateTable(id, dto);
  }

  @Delete('tables/:id')
  deleteTable(@Param('id') id: string) {
    return this.catalog.deleteTable(id);
  }

  // ---- Категории и блюда ----
  @Get('menu/overview')
  menuOverview() {
    return this.catalog.menuOverview();
  }

  @Get('categories')
  categories() {
    return this.catalog.categoriesAll();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.catalog.deleteCategory(id);
  }

  @Get('dishes')
  dishes(@Query('categoryId') categoryId?: string, @Query('search') search?: string) {
    return this.catalog.dishesAll({ categoryId, search });
  }

  @Post('dishes')
  createDish(@Body() dto: CreateDishDto) {
    return this.catalog.createDish(dto);
  }

  @Patch('dishes/:id')
  updateDish(@Param('id') id: string, @Body() dto: UpdateDishDto) {
    return this.catalog.updateDish(id, dto);
  }

  @Delete('dishes/:id')
  deleteDish(@Param('id') id: string) {
    return this.catalog.deleteDish(id);
  }
}
