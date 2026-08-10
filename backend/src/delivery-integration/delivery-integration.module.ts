import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryIntegrationController } from './delivery-integration.controller';
import { DeliveryIntegrationService } from './delivery-integration.service';
import { DeliveryApiKeyGuard } from './delivery-api-key.guard';

@Module({
  imports: [OrdersModule],
  controllers: [DeliveryIntegrationController],
  providers: [DeliveryIntegrationService, DeliveryApiKeyGuard],
})
export class DeliveryIntegrationModule {}
