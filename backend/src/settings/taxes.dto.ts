import { MenuTaxType } from '@prisma/client';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SaveTaxDto {
  @IsString() @MaxLength(80) name: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) rate: number;
  @IsEnum(MenuTaxType) type: MenuTaxType;
}

export class TaxListQuery {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsEnum(MenuTaxType) type?: MenuTaxType;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) rate?: number;
  @IsOptional() @IsIn(['asc', 'desc']) sort?: 'asc' | 'desc';
  @IsOptional() @IsString() @MaxLength(80) columns?: string;
}

export const TAX_REPORT_KINDS = ['fiscal', 'nonFiscal', 'reversal'] as const;
export type TaxReportKind = typeof TAX_REPORT_KINDS[number];
const TAX_REPORT_OPERATIONS = ['fiscal', 'nonFiscal', 'fiscalReversal', 'nonFiscalReversal'] as const;
export type TaxReportOperation = typeof TAX_REPORT_OPERATIONS[number];

export class TaxReportQuery {
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
  @IsOptional() @IsIn([...TAX_REPORT_OPERATIONS, 'reversal']) kind?: TaxReportOperation | 'reversal';
  @IsOptional() @IsIn(['name', 'rate', 'salesAmount', 'amount']) sort?: 'name' | 'rate' | 'salesAmount' | 'amount';
  @IsOptional() @IsIn(['asc', 'desc']) direction?: 'asc' | 'desc';
}
