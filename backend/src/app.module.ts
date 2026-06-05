import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HallsModule } from './halls/halls.module';
import { TablesModule } from './tables/tables.module';
import { CategoriesModule } from './categories/categories.module';
import { DishesModule } from './dishes/dishes.module';
import { OrdersModule } from './orders/orders.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { PaymentsModule } from './payments/payments.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WaiterShiftsModule } from './waiter-shifts/waiter-shifts.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    HallsModule,
    TablesModule,
    CategoriesModule,
    DishesModule,
    OrdersModule,
    WaiterShiftsModule,
    KitchenModule,
    PaymentsModule,
  ],
  providers: [
    // Глобально: сначала проверка JWT, затем проверка роли.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
