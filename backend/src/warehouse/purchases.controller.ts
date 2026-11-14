import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PurchaseStatus, Role } from '@prisma/client';
import { PurchasesService } from './purchases.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CreatePurchaseDto, UpdatePurchaseDto } from './dto';

@Controller('admin/warehouse/purchases')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.warehouse')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('overview')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  overview(@Query('from') from?: string, @Query('to') to?: string, @Query('warehouseId') warehouseId?: string) {
    return this.purchases.overview({ from, to, warehouseId });
  }

  @Get()
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  findAll(
    @Query('status') status?: PurchaseStatus,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.purchases.findAll({ status, search, from, to, warehouseId });
  }

  @Get(':id')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  findOne(@Param('id') id: string) {
    return this.purchases.findOne(id);
  }

  @Post()
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.purchases.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.purchases.update(id, dto, user);
  }

  @Post(':id/complete')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.purchases.complete(id, user);
  }

  @Post(':id/cancel')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  cancel(@Param('id') id: string) {
    return this.purchases.cancel(id);
  }
}
