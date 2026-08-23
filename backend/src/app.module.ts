import { Module } from '@nestjs/common';
import { Module as PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

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
