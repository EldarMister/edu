import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { IngredientKind } from '@prisma/client';

export const warehouseReportViews = ['balances', 'movement_summary', 'movements', 'purchases', 'losses', 'sales', 'variances'] as const;
export type WarehouseReportView = typeof warehouseReportViews[number];

const ingredientKinds = Object.values(IngredientKind);
const repeatedQueryValue = ({ value }: { value: unknown }) => typeof value === 'string' ? [value] : value;

export class FoodCostReportQuery {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}

export class FoodCostExportQuery extends FoodCostReportQuery {
  @IsIn(['positions', 'ingredients'])
  tab: 'positions' | 'ingredients';

  @IsOptional() @IsString() @MaxLength(160)
  search?: string;
}

export class WarehouseReportQuery {
  @IsOptional() @IsIn(warehouseReportViews)
  view?: WarehouseReportView;

  @IsOptional() @IsString() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsString() @MaxLength(8192)
  warehouseIds?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  nameSort?: 'asc' | 'desc';

  @IsOptional() @IsString() @MaxLength(10)
  from?: string;

  @IsOptional() @IsString() @MaxLength(10)
  to?: string;

  @IsOptional() @IsString() @MaxLength(160)
  ingredientId?: string;

  @IsOptional() @IsString() @MaxLength(160)
  search?: string;

  @IsOptional() @IsIn(['equals', 'notEquals', 'contains', 'empty', 'notEmpty'])
  nameCondition?: 'equals' | 'notEquals' | 'contains' | 'empty' | 'notEmpty';

  @IsOptional() @IsString() @MaxLength(160)
  nameValue?: string;

  @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @IsOptional() @Transform(repeatedQueryValue) @IsArray() @ArrayMaxSize(100)
  @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(120, { each: true })
  categories?: string[];

  @IsOptional() @IsIn(ingredientKinds)
  kind?: IngredientKind;

  @IsOptional() @Transform(repeatedQueryValue) @IsArray() @ArrayMaxSize(ingredientKinds.length)
  @IsIn(ingredientKinds, { each: true })
  kinds?: IngredientKind[];

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

export class WarehouseMovementExportQuery extends WarehouseReportQuery {
  @IsOptional() @IsString() @MaxLength(220)
  columns?: string;
}
