import { Module } from '@nestjs/common';
import { ReceiptPrintsService } from './receipt-prints.service';
import { ReceiptPrintsController } from './receipt-prints.controller';
import { FiscalModule } from '../fiscal/fiscal.module';

@Module({
  imports: [FiscalModule],
  controllers: [ReceiptPrintsController],
  providers: [ReceiptPrintsService],
})
export class ReceiptPrintsModule {}
