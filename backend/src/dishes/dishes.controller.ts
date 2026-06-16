import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DishesService } from './dishes.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('dishes')
export class DishesController {
  constructor(private readonly dishes: DishesService) {}

  @Get()
  findAll(@Query('categoryId') categoryId?: string, @Query('search') search?: string) {
    return this.dishes.findAll({ categoryId, search });
  }

  /** Фото блюда с долгим кэшем (URL версионируется по updatedAt). Публично — нужно QR-меню. */
  @Public()
  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const img = await this.dishes.getDishImage(id);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(img.buffer);
  }
}
