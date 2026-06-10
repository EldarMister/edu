import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateCategoryDto,
  CreateDishDto,
  CreateSetDto,
  CreateHallDto,
  CreateTableDto,
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
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.catalog.createCategory(dto, user);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.catalog.updateCategory(id, dto, user);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.deleteCategory(id, user);
  }

  @Get('dishes')
  dishes(@Query('categoryId') categoryId?: string, @Query('search') search?: string) {
    return this.catalog.dishesAll({ categoryId, search });
  }

  @Post('dishes')
  createDish(@Body() dto: CreateDishDto, @CurrentUser() user: AuthUser) {
    return this.catalog.createDish(dto, user);
  }

  @Patch('dishes/:id')
  updateDish(@Param('id') id: string, @Body() dto: UpdateDishDto, @CurrentUser() user: AuthUser) {
    return this.catalog.updateDish(id, dto, user);
  }

  @Delete('dishes/:id')
  deleteDish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.deleteDish(id, user);
  }

  // ---- Сеты ----
  @Get('sets')
  sets() {
    return this.catalog.setsAll();
  }

  @Post('sets')
  createSet(@Body() dto: CreateSetDto, @CurrentUser() user: AuthUser) {
    return this.catalog.createSet(dto, user);
  }

  @Patch('sets/:id')
  updateSet(@Param('id') id: string, @Body() dto: UpdateSetDto, @CurrentUser() user: AuthUser) {
    return this.catalog.updateSet(id, dto, user);
  }

  @Delete('sets/:id')
  deleteSet(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.deleteDish(id, user);
  }
}
