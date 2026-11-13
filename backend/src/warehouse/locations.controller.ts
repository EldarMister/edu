import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsDefined, IsNotEmpty, IsNumber, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { WarehouseLocationsService } from './locations.service';

class WarehouseNameDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  name: string;
}

class StationWarehouseDto {
  @ValidateIf((_, value) => value !== null)
  @IsDefined() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId: string | null;
}

class TransferStockDto {
  @IsString() @IsNotEmpty() @MaxLength(160)
  ingredientId: string;

  @IsString() @IsNotEmpty() @MaxLength(160)
  fromWarehouseId: string;

  @IsString() @IsNotEmpty() @MaxLength(160)
  toWarehouseId: string;

  @IsNumber() @Min(0.000001)
  quantity: number;

  @IsString() @IsNotEmpty() @MaxLength(16)
  unit: string;
}

@Controller('admin/warehouse/locations')
@Roles(Role.OWNER, Role.ADMIN)
@RequirePermission('sections.warehouse')
export class WarehouseLocationsController {
  constructor(private readonly locations: WarehouseLocationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.locations.list(user.cafeId);
  }

  @Post()
  @Roles(Role.OWNER)
  create(@CurrentUser() user: AuthUser, @Body() dto: WarehouseNameDto) {
    return this.locations.save(user.cafeId, dto.name);
  }

  @Patch('stations/:stationId')
  @Roles(Role.OWNER)
  route(@CurrentUser() user: AuthUser, @Param('stationId') stationId: string, @Body() dto: StationWarehouseDto) {
    return this.locations.route(user, stationId, dto.warehouseId);
  }

  @Patch(':id')
  @Roles(Role.OWNER)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseNameDto) {
    return this.locations.save(user.cafeId, dto.name, id);
  }

  @Post('transfer')
  transfer(@Body() dto: TransferStockDto) {
    return this.locations.transfer(dto);
  }
}
