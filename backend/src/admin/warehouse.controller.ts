import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminWarehouseService } from './warehouse.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('admin/warehouse')
@Roles(Role.ADMIN, Role.OWNER)
export class AdminWarehouseController {
  constructor(private readonly warehouse: AdminWarehouseService) {}

  @Get('items/overview')
  overview() {
    return this.warehouse.overview();
  }

  @Get('items')
  getItems(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.warehouse.getItems(search, categoryId);
  }
}
