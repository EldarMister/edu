import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateCategoryDto,
  CreateDishDto,
  CreateSetDto,
  CreateHallDto,
  CreateTableDto,
  DeleteCategoryDto,
  MoveCategoryDishesDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
  UpdateDishDto,
  UpdateSetDto,
  UpdateHallDto,
  UpdateTableDto,
} from './dto';

@Controller('admin')
@Roles(Role.ADMIN, Role.OWNER)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ---- Залы и столы (раздел «Столы») ----
  @Get('tables/overview')
  @RequirePermission('sections.tables')
  tablesOverview() {
    return this.catalog.tablesOverview();
  }

  @Get('halls')
  @RequirePermission('sections.tables')
  halls() {
    return this.catalog.hallsWithTables();
  }

  @Post('halls')
  @RequirePermission('sections.tables')
  createHall(@Body() dto: CreateHallDto) {
    return this.catalog.createHall(dto);
  }

  @Patch('halls/:id')
  @RequirePermission('sections.tables')
  updateHall(@Param('id') id: string, @Body() dto: UpdateHallDto) {
    return this.catalog.updateHall(id, dto);
  }

  @Delete('halls/:id')
  @RequirePermission('sections.tables')
  deleteHall(@Param('id') id: string) {
    return this.catalog.deleteHall(id);
  }

  @Post('tables')
  @RequirePermission('sections.tables')
  createTable(@Body() dto: CreateTableDto) {
    return this.catalog.createTable(dto);
  }

  @Patch('tables/:id')
  @RequirePermission('sections.tables')
  updateTable(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.catalog.updateTable(id, dto);
  }

  @Delete('tables/:id')
  @RequirePermission('sections.tables')
  deleteTable(@Param('id') id: string) {
    return this.catalog.deleteTable(id);
  }

  // ---- Категории и блюда (раздел «Меню») ----
  @Get('menu/overview')
  @RequirePermission('sections.menu')
  menuOverview() {
    return this.catalog.menuOverview();
  }

  @Get('categories')
  @RequirePermission('sections.menu')
  categories() {
    return this.catalog.categoriesAll();
  }

  @Post('categories')
  @RequirePermission('sections.menu')
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.catalog.createCategory(dto, user);
  }

  @Patch('categories/reorder')
  @RequirePermission('sections.menu')
  reorderCategories(@Body() dto: ReorderCategoriesDto, @CurrentUser() user: AuthUser) {
    return this.catalog.reorderCategories(dto.ids, user);
  }

  @Post('categories/move-dishes')
  @RequirePermission('sections.menu')
  moveCategoryDishes(@Body() dto: MoveCategoryDishesDto, @CurrentUser() user: AuthUser) {
    return this.catalog.moveCategoryDishes(dto.fromCategoryId, dto.toCategoryId, user);
  }

  @Patch('categories/:id')
  @RequirePermission('sections.menu')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.catalog.updateCategory(id, dto, user);
  }

  @Delete('categories/:id')
  @RequirePermission('sections.menu')
  deleteCategory(@Param('id') id: string, @Body() dto: DeleteCategoryDto, @CurrentUser() user: AuthUser) {
    return this.catalog.deleteCategory(id, dto ?? {}, user);
  }

  @Get('dishes')
  @RequirePermission('sections.menu')
  dishes(@Query('categoryId') categoryId?: string, @Query('search') search?: string) {
    return this.catalog.dishesAll({ categoryId, search });
  }

  @Post('dishes')
  @RequirePermission('sections.menu')
  createDish(@Body() dto: CreateDishDto, @CurrentUser() user: AuthUser) {
    return this.catalog.createDish(dto, user);
  }

  @Patch('dishes/:id')
  @RequirePermission('sections.menu')
  updateDish(@Param('id') id: string, @Body() dto: UpdateDishDto, @CurrentUser() user: AuthUser) {
    return this.catalog.updateDish(id, dto, user);
  }

  @Delete('dishes/:id')
  @RequirePermission('sections.menu')
  deleteDish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.deleteDish(id, user);
  }

  // ---- Сеты (раздел «Меню») ----
  @Get('sets')
  @RequirePermission('sections.menu')
  sets() {
    return this.catalog.setsAll();
  }

  @Post('sets')
  @RequirePermission('sections.menu')
  createSet(@Body() dto: CreateSetDto, @CurrentUser() user: AuthUser) {
    return this.catalog.createSet(dto, user);
  }

  @Patch('sets/:id')
  @RequirePermission('sections.menu')
  updateSet(@Param('id') id: string, @Body() dto: UpdateSetDto, @CurrentUser() user: AuthUser) {
    return this.catalog.updateSet(id, dto, user);
  }

  @Delete('sets/:id')
  @RequirePermission('sections.menu')
  deleteSet(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.deleteDish(id, user);
  }
}
