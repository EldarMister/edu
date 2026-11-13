import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IngredientKind } from '@prisma/client';

export const warehouseReportViews = ['balances', 'movement_summary', 'movements', 'purchases', 'losses', 'sales', 'variances'] as const;
export type WarehouseReportView = typeof warehouseReportViews[number];

export class WarehouseReportQuery {
  @IsOptional() @IsIn(warehouseReportViews)
  view?: WarehouseReportView;

  @IsOptional() @IsString() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsString() @MaxLength(10)
  from?: string;

  @IsOptional() @IsString() @MaxLength(10)
  to?: string;

  @IsOptional() @IsString() @MaxLength(160)
  ingredientId?: string;

  @IsOptional() @IsString() @MaxLength(160)
  search?: string;

  @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @IsOptional() @IsIn(Object.values(IngredientKind))
  kind?: IngredientKind;

  @IsOptional() @IsIn(['true', 'false'])
  onlyWithMovement?: 'true' | 'false';

  @IsOptional() @IsString() @MaxLength(160)
  employeeId?: string;

  @IsOptional() @IsString() @MaxLength(40)
  type?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  pageSize?: number;
}
