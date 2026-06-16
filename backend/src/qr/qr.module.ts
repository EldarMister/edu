import { Module } from '@nestjs/common';
import { QrService } from './qr.service';
import { QrController } from './qr.controller';
import { DishesModule } from '../dishes/dishes.module';
import { CategoriesModule } from '../categories/categories.module';
import { OrdersModule } from '../orders/orders.module';

// Prisma, Settings, Realtime — глобальные модули.
@Module({
  imports: [DishesModule, CategoriesModule, OrdersModule],
  controllers: [QrController],
  providers: [QrService],
})
export class QrModule {}
