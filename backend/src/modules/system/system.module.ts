import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { BackupService } from './backup.service';

/**
 * SELIM-ERP W2 — وحدة النظام: النسخ الاحتياطي/الاستعادة من الواجهة.
 * SUPER_ADMIN فقط (على الكنترولر) — لا تبعيات خارج PrismaService.
 */
@Module({
  providers: [BackupService],
  controllers: [SystemController],
  exports: [BackupService],
})
export class SystemModule {}
