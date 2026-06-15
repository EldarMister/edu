import { Module } from '@nestjs/common';
import { DishesService } from './dishes.service';
import { DishesController } from './dishes.controller';
import { DishPopularityService } from './dish-popularity.service';

@Module({
  controllers: [DishesController],
  providers: [DishesService, DishPopularityService],
  exports: [DishesService, DishPopularityService],
})
export class DishesModule {}
