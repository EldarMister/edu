import { BadRequestException } from '@nestjs/common';
import { PurchaseStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, isISO8601 } from 'class-validator';
import { warehouseDateRange } from './report-range';

const repeated = ({ value }: { value: unknown }) => typeof value === 'string' ? [value] : value;

export class PurchaseListQuery {
  @IsOptional() @IsIn(Object.values(PurchaseStatus))
  status?: PurchaseStatus;

  @IsOptional() @IsString() @MaxLength(160)
  search?: string;

  @IsOptional() @IsString() @MaxLength(40)
  from?: string;

  @IsOptional() @IsString() @MaxLength(40)
  to?: string;

  @IsOptional() @IsString() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @Transform(repeated) @IsArray() @ArrayMaxSize(100)
  @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(160, { each: true })
  suppliers?: string[];

  @IsOptional() @Transform(repeated) @IsArray() @ArrayMaxSize(100)
  @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(120, { each: true })
  categories?: string[];

  @IsOptional() @IsIn(['asc', 'desc'])
  dateSort?: 'asc' | 'desc';
}

export class PurchaseExportQuery extends PurchaseListQuery {
  @IsOptional() @IsString() @MaxLength(160)
  columns?: string;
}

// Calendar dates mean Bishkek business days; timestamps retain their exact offset.
export function purchaseDateRange(from?: string, to?: string) {
  const parse = (value: string, end: boolean) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const range = warehouseDateRange(end ? undefined : value, end ? value : undefined)!;
      return (end ? range.lte : range.gte)!;
    }
    if (!isISO8601(value, { strict: true, strictSeparator: true }) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      throw new BadRequestException('Укажите дату ГГГГ-ММ-ДД или время ISO с часовым поясом');
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException('Указана некорректная дата');
    return date;
  };
  const gte = from ? parse(from, false) : undefined;
  const lte = to ? parse(to, true) : undefined;
  if (gte && lte && gte > lte) throw new BadRequestException('Начало периода должно быть раньше окончания');
  return gte || lte ? { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } : undefined;
}
