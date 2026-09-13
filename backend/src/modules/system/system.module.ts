import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { AlertsService } from './alerts.service';
import { AuditLogsService } from './audit-logs.service';
import { BackupService } from './backup.service';
import { DevicesService } from './devices.service';
import { FactorySettingsService } from './factory-settings.service';

/**
 * SELIM-ERP W2/W3 — وحدة النظام:
 * - W2: النسخ الاحتياطي/الاستعادة من الواجهة (SUPER_ADMIN فقط).
 * - W3: إعدادات المصنع + التنبيهات الذكية + سجل التدقيق + الأجهزة
 *   (نقل من factory-settings/alerts/audit-logs/devices في Selim ERP).
 * لا تبعيات خارج PrismaService.
 */
@Module({
  providers: [
    BackupService,
    FactorySettingsService,
    AlertsService,
    AuditLogsService,
    DevicesService,
  ],
  controllers: [SystemController],
  exports: [BackupService, FactorySettingsService],
})
export class SystemModule {}
