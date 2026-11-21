import { Module } from '@nestjs/common';
import { KitchenService } from './kitchen.service';
import { KitchenController } from './kitchen.controller';
import { OrdersModule } from '../orders/orders.module';
import { PreparationStationsController } from './preparation-stations.controller';

@Module({
  imports: [OrdersModule],
  controllers: [KitchenController, PreparationStationsController],
  providers: [KitchenService],
})
export class KitchenModule {}
