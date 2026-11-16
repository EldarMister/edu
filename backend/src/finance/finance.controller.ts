import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  FinanceAccountCreateDto, FinanceAccountUpdateDto, FinanceCategoryCreateDto, FinanceCategoryUpdateDto,
  FinanceQueryDto, FinanceTransactionDto, SalaryAccrualDto, SalaryPaymentDto,
  FinanceTransactionMetadataDto, FinanceTransactionReverseDto,
} from './finance.dto';
import { FinanceService } from './finance.service';
import { PayrollReportDto } from './finance.dto';

@Roles(Role.OWNER, Role.ADMIN)
@Controller('admin/finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('access')
  access(@CurrentUser() actor: AuthUser) {
    return this.finance.access(actor);
  }

  @Get()
  overview(@CurrentUser() actor: AuthUser, @Query() query: FinanceQueryDto) {
    return this.finance.overview(actor, query);
  }

  @Post('accounts')
  createAccount(@CurrentUser() actor: AuthUser, @Body() input: FinanceAccountCreateDto) {
    return this.finance.createAccount(actor, input);
  }

  @Patch('accounts/:id')
  updateAccount(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: FinanceAccountUpdateDto) {
    return this.finance.updateAccount(actor, id, input);
  }

  @Post('categories')
  createCategory(@CurrentUser() actor: AuthUser, @Body() input: FinanceCategoryCreateDto) {
    return this.finance.createCategory(actor, input);
  }

  @Patch('categories/:id')
  updateCategory(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: FinanceCategoryUpdateDto) {
    return this.finance.updateCategory(actor, id, input);
  }

  @Post('transactions')
  post(@CurrentUser() actor: AuthUser, @Body() input: FinanceTransactionDto) {
    return this.finance.post(actor, input);
  }

  @Patch('transactions/:id')
  updateTransaction(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: FinanceTransactionMetadataDto) {
    return this.finance.updateTransaction(actor, id, input);
  }

  @Post('transactions/:id/reverse')
  reverseTransaction(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: FinanceTransactionReverseDto) {
    return this.finance.reverseTransaction(actor, id, input.reason);
  }

  @Get('payroll')
  payrollReport(@CurrentUser() actor: AuthUser, @Query() query: PayrollReportDto) {
    return this.finance.payroll(actor, query);
  }

  @Post('payroll/calculated')
  accrueCalculated(@CurrentUser() actor: AuthUser, @Body() input: SalaryAccrualDto) {
    return this.finance.accrueCalculated(actor, input);
  }

  @Post('payroll')
  accrue(@CurrentUser() actor: AuthUser, @Body() input: SalaryAccrualDto) {
    return this.finance.accrue(actor, input);
  }

  @Post('payroll/:id/pay')
  pay(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: SalaryPaymentDto) {
    return this.finance.paySalary(actor, id, input);
  }
}
