import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const PLAN_COLUMNS = 24;
const PLAN_MAX_ROWS = 600;

class FloorPlanTableDto {
  @IsString() @IsNotEmpty() @MaxLength(64) tableId!: string;
  @IsInt() @Min(0) @Max(PLAN_COLUMNS - 4) x!: number;
  @IsInt() @Min(0) @Max(PLAN_MAX_ROWS - 4) y!: number;
  @IsInt() @Min(4) @Max(PLAN_COLUMNS) width!: number;
  @IsInt() @Min(4) @Max(PLAN_MAX_ROWS) height!: number;
  @IsIn(['rectangle', 'round']) shape!: 'rectangle' | 'round';
  @IsOptional() @IsString() @MaxLength(30) label?: string;
}

export class SaveFloorPlanDto {
  @IsInt() @Min(0) @Max(2147483646) version!: number;

  @IsArray() @ArrayMaxSize(300) @ArrayUnique((item: FloorPlanTableDto) => item?.tableId)
  @ValidateNested({ each: true }) @Type(() => FloorPlanTableDto)
  tables!: FloorPlanTableDto[];
}

export class SetFloorPlanModeDto {
  @IsBoolean() useFloorPlan!: boolean;
}

export function withinFloorPlan(table: FloorPlanTableDto) {
  return table.x + table.width <= PLAN_COLUMNS && table.y + table.height <= PLAN_MAX_ROWS;
}
