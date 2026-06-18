import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PurchaseStatus, Role } from '@prisma/client';
import { PurchasesService } from './purchases.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePurchaseDto, UpdatePurchaseDto } from './dto';

@Controller('admin/warehouse/purchases')
@Roles(Role.ADMIN, Role.OWNER)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('overview')
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.purchases.overview({ from, to });
  }

  @Get()
  findAll(
    @Query('status') status?: PurchaseStatus,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.purchases.findAll({ status, search, from, to });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchases.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePurchaseDto) {
    return this.purchases.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseDto) {
    return this.purchases.update(id, dto);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    return this.purchases.complete(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.purchases.cancel(id);
  }
}
