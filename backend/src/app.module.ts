import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductionModule } from './modules/production/production.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { HrModule } from './modules/hr/hr.module';
import { SalesModule } from './modules/sales/sales.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { QualityModule } from './modules/quality/quality.module';
import { ShippingModule } from './modules/shipping/shipping.module';

@Module({
  imports: [
    // إعدادات البيئة (.env)
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // نظام الأحداث بين الموديولات
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
    // Prisma (قاعدة البيانات)
    PrismaModule,
    InventoryModule,
    ProductionModule,
    AuthModule,
    ProductsModule,
    HrModule,
    SalesModule,
    AccountingModule,
    QualityModule,
    ShippingModule,
    // سيتم إضافة باقي الموديولات هنا تباعاً
    // AuthModule,
    // ProductsModule,
    // InventoryModule,
    // ProductionModule,
    // QualityModule,
    // HrModule,
    // SalesModule,
    // ShippingModule,
    // AccountingModule,
    // ReportsModule,
    // DashboardModule,
  ],
})
export class AppModule {}
