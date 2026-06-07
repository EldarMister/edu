import { Module } from '@nestjs/common';
import { ReceiptPrintsService } from './receipt-prints.service';
import { ReceiptPrintsController } from './receipt-prints.controller';

@Module({
  controllers: [ReceiptPrintsController],
  providers: [ReceiptPrintsService],
})
export class ReceiptPrintsModule {}
