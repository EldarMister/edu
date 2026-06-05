import { Module } from '@nestjs/common';
import { KitchenService } from './kitchen.service';
import { KitchenController } from './kitchen.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [KitchenController],
  providers: [KitchenService],
})
export class KitchenModule {}
