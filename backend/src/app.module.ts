import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductionModule } from './modules/production/production.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { HrModule } from './modules/hr/hr.module';
import { SalesModule } from './modules/sales/sales.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { QualityModule } from './modules/quality/quality.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';

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
  ],
  // إصلاح خلل قديم كشفه اختبار GF-0002: AppController/AppService لم يكونا
  // مسجلين في المodule — فكان GET / يرجع 404 رغم أن app.e2e-spec الأصلي ينتظر 200
  controllers: [AppController],
  providers: [
    AppService,
    // GF-0002: حماية عامة fail-closed —
    // 1) JwtAuthGuard: كل مسار يتطلب JWT إلا المعلّم بـ @Public()
    // 2) RolesGuard: فرض @Roles() حيث وُضع (الترتيب مهم: المصادقة ثم الصلاحيات)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
