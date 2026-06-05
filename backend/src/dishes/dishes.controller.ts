import { Controller, Get, Query } from '@nestjs/common';
import { DishesService } from './dishes.service';

@Controller('dishes')
export class DishesController {
  constructor(private readonly dishes: DishesService) {}

  @Get()
  findAll(@Query('categoryId') categoryId?: string, @Query('search') search?: string) {
    return this.dishes.findAll({ categoryId, search });
  }
}
