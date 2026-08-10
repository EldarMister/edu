import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { DeliveryApiKeyGuard } from './delivery-api-key.guard';
import { DeliveryIntegrationService } from './delivery-integration.service';
import { CreateDeliveryOrderDto } from './dto/create-delivery-order.dto';

@Public()
@UseGuards(DeliveryApiKeyGuard)
@Controller('integration/v1')
export class DeliveryIntegrationController {
  constructor(private readonly delivery: DeliveryIntegrationService) {}

  @Post('orders')
  createOrder(@Body() dto: CreateDeliveryOrderDto) {
    return this.delivery.createOrder(dto);
  }

  @Get('orders/:externalOrderId')
  getOrder(@Param('externalOrderId') externalOrderId: string) {
    return this.delivery.getOrder(externalOrderId);
  }

  @Get('menu')
  getMenu() {
    return this.delivery.getMenu();
  }

  @Get('stop-list')
  getStopList() {
    return this.delivery.getStopList();
  }
}
