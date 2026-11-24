import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  findAll() {
    return this.categories.findAll();
  }

  @Public()
  @Get(':id/image')
  async image(@Param('id') id: string, @Query('v') version: string, @Res() response: Response) {
    const image = await this.categories.image(id, version);
    if (!image) return response.status(404).end();
    return response.set({ 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff' }).end(image.buffer);
  }
}
