import { Module } from '@nestjs/common';
import { ReceiptPrintsService } from './receipt-prints.service';
import { ReceiptPrintsController } from './receipt-prints.controller';
import { FiscalModule } from '../fiscal/fiscal.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [FiscalModule, PushModule],
  controllers: [ReceiptPrintsController],
  providers: [ReceiptPrintsService],
})
export class ReceiptPrintsModule {}
