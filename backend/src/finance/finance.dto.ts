import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

const MAX_MONEY = 9_999_999_999.99;
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export class FinanceQueryDto {
  @IsOptional() @Matches(datePattern) from?: string;
  @IsOptional() @Matches(datePattern) to?: string;
  @IsOptional() @Matches(monthPattern) month?: string;
  @IsOptional() @IsString() @Length(1, 120) accountId?: string;
  @IsOptional() @Matches(/^[\w-]{1,120}(,[\w-]{1,120}){0,99}$/) accountIds?: string;
}

export class CashHandoverQueryDto {
  @IsOptional() @Matches(datePattern) from?: string;
  @IsOptional() @Matches(datePattern) to?: string;
}

export class CashHandoverSaveDto {
  @IsString() @Length(1, 120) employeeId!: string;
  @Matches(datePattern) date!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99_999_999.99) amount!: number;
  @IsOptional() @IsISO8601({ strict: true }) expectedReceivedAt?: string;
}

export class CashHandoverSettingsDto {
  @IsBoolean() enabled!: boolean;
}

export class FinanceAccountUpdateDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsIn(['cash', 'noncash']) type?: 'cash' | 'noncash';
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-MAX_MONEY) @Max(MAX_MONEY) openingBalance?: number;
}

export class FinanceAccountCreateDto {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsIn(['cash', 'noncash']) type!: 'cash' | 'noncash';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-MAX_MONEY) @Max(MAX_MONEY) openingBalance?: number;
}

class FinanceCategoryGrantsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Length(1, 120, { each: true }) userIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Length(1, 120, { each: true }) positionIds?: string[];
  @IsOptional() @IsString() @Length(1, 120) parentId?: string | null;
  @IsOptional() @IsBoolean() showOnPos?: boolean;
  @IsOptional() @IsBoolean() showInProfitLoss?: boolean;
}

export class FinanceCategoryUpdateDto extends FinanceCategoryGrantsDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsIn(['income', 'expense', 'both']) kind?: 'income' | 'expense' | 'both';
}

export class FinanceCategoryCreateDto extends FinanceCategoryGrantsDto {
  @IsString() @Length(1, 120) name!: string;
  @IsIn(['income', 'expense', 'both']) kind!: 'income' | 'expense' | 'both';
}

export class FinanceCategoryDeleteDto {
  @IsOptional() @IsString() @Length(1, 120) replacementId?: string;
}

class MoneyFieldsDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(MAX_MONEY) amount!: number;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class MoneyPostDto extends MoneyFieldsDto {
  @IsUUID() requestKey!: string;
}

export class FinanceTransactionEditDto extends MoneyFieldsDto {
  @IsOptional() @Matches(datePattern) dealDate?: string | null;
  @IsIn(['income', 'expense', 'transfer']) kind!: 'income' | 'expense' | 'transfer';
  @IsString() @Length(1, 120) accountId!: string;
  @IsOptional() @IsString() @Length(1, 120) categoryId?: string;
  @IsOptional() @IsString() @Length(1, 120) destinationAccountId?: string;
  @IsOptional() @IsISO8601({ strict: true }) occurredAt?: string;
}

export class FinanceTransactionDto extends FinanceTransactionEditDto {
  @IsUUID() requestKey!: string;
}

export class FinanceTransactionMetadataDto {
  @IsOptional() @IsString() @Length(1, 120) categoryId?: string | null;
  @IsOptional() @IsString() @Length(0, 500) note?: string | null;
}

export class FinanceTransactionReverseDto {
  @IsString() @Length(1, 500) reason!: string;
}

export class SalaryAccrualDto extends MoneyPostDto {
  @IsString() @Length(1, 120) userId!: string;
  @Matches(monthPattern) month!: string;
  @IsOptional() @IsBoolean() supplemental?: boolean;
}

export class PayrollReportDto {
  @IsOptional() @Matches(monthPattern) month?: string;
  @IsOptional() @Matches(datePattern) from?: string;
  @IsOptional() @Matches(datePattern) to?: string;
}

export class SalaryPaymentDto extends MoneyPostDto {
  @IsString() @Length(1, 120) accountId!: string;
}

export class SalaryCorrectionDto {
  @IsUUID() requestKey!: string;
  @IsInt() @Min(0) revision!: number;
  @IsString() @Length(1, 500) reason!: string;
}

export class SalaryAccrualEditDto extends SalaryCorrectionDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(MAX_MONEY) amount!: number;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}
