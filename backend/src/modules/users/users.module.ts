import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * CC-9 (P1 — GF-IMP-W2): موديول إدارة المستخدمين.
 *
 * لا يستورد شيئًا: PrismaModule عالمي (@Global) والحراس (JwtAuthGuard +
 * RolesGuard) مسجلون APP_GUARD في app.module — بلا أي دور في AuthModule
 * حتى لا نعيد تسجيل JwtStrategy (تسجيل مزدوج = استراتيجية passport مكررة).
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
