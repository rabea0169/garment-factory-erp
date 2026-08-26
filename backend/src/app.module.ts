import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductionModule } from './modules/production/production.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { HrModule } from './modules/hr/hr.module';
import { SalesModule } from './modules/sales/sales.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { QualityModule } from './modules/quality/quality.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FinancialModule } from './core/financial/financial.module';
import { HealthController } from './common/health.controller';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    // إعدادات البيئة (.env)
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // C1: Rate limiter عام — 100 طلب/دقيقة افتراضياً لكل IP.
    // يضيق /auth/login إلى 10/دقيقة عبر override لنفس named throttler.
    // لا نضيف throttler باسم auth عالمياً، لأن كل named throttler يُطبَّق على
    // كل المسارات ما لم يُتجاوز صراحة، وكان ذلك يخنق كل API إلى 10 طلبات.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
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
    // A1/A2/A3: محرك القيد المزدوج الموحد — يستهلكه AccountingService وSalesService.
    FinancialModule,
    InventoryModule,
    ProductionModule,
    AuthModule,
    ProductsModule,
    HrModule,
    SalesModule,
    AccountingModule,
    QualityModule,
    ShippingModule,
    PurchasingModule,
    DashboardModule,
  ],
  // إصلاح خلل قديم كشفه اختبار GF-0002: AppController/AppService لم يكونا
  // مسجلين في المodule — فكان GET / يرجع 404 رغم أن app.e2e-spec الأصلي ينتظر 200
  // C9: HealthController عام — يُعلَّم بـ @Public + @SkipThrottle في داخله.
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // GF-0002: حماية عامة fail-closed —
    // 1) ThrottlerGuard: تطبيق rate-limit على كل المسارات (ما لم يُعلَّم بـ @SkipThrottle)
    // 2) JwtAuthGuard: كل مسار يتطلب JWT إلا المعلّم بـ @Public()
    // 3) RolesGuard: فرض @Roles() حيث وُضع
    // (الترتيب مهم: throttler ← auth ← roles)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
