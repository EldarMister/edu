import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { DeliveryApiKeyGuard } from './delivery-api-key.guard';
import { DeliveryIntegrationService } from './delivery-integration.service';
import { CreateDeliveryOrderDto } from './dto/create-delivery-order.dto';
import { ImportDeliveryMenuDto } from './dto/import-delivery-menu.dto';

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

  @Put('menu')
  importMenu(@Body() dto: ImportDeliveryMenuDto) {
    return this.delivery.importMenu(dto);
  }

  @Get('stop-list')
  getStopList() {
    return this.delivery.getStopList();
  }
}
