import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { CashHandoverService } from './cash-handover.service';

@Module({ controllers: [FinanceController], providers: [FinanceService, CashHandoverService] })
export class FinanceModule {}
