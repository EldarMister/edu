import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { ReceiptPrintsModule } from './receipt-prints/receipt-prints.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { QrModule } from './qr/qr.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WaiterShiftsModule } from './waiter-shifts/waiter-shifts.module';
import { AdminModule } from './admin/admin.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { SettingsModule } from './settings/settings.module';
import { PushModule } from './push/push.module';
import { AuditModule } from './audit/audit.module';
import { TtsModule } from './tts/tts.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { BackupBotModule } from './backup-bot/backup-bot.module';
import { PlatformModule } from './platform/platform.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
    ReceiptPrintsModule,
    FiscalModule,
    QrModule,
    QueueModule,
    AdminModule,
    WarehouseModule,
    SettingsModule,
    PushModule,
    AuditModule,
    TtsModule,
    MonitoringModule,
    BackupBotModule,
    PlatformModule,
  ],
  providers: [
    // Глобально: сначала проверка JWT, затем роли, затем права доступа к разделам.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Открывает контекст тенанта на каждый запрос (cafeId заполняется после авторизации).
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
