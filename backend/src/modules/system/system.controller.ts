import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { AlertsService } from './alerts.service';
import { AuditLogsService } from './audit-logs.service';
import { BackupService, RESTORE_CONFIRM_PHRASE } from './backup.service';
import { DevicesService } from './devices.service';
import { FactorySettingsService } from './factory-settings.service';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateFactorySettingsDto } from './dto/update-factory-settings.dto';

/** شكل ملف multer المرفوع (بلا @types/multer — الحد الأدنى المستخدم). */
interface UploadedBackupFile {
  buffer: Buffer;
  originalname?: string;
  size?: number;
}

/** حد ملف الاستعادة — 200MB يستوعب نسخًا كبيرة جدًا (activity_logs). */
const MAX_RESTORE_FILE_BYTES = 200 * 1024 * 1024;

/**
 * SELIM-ERP W2/W3 — كنترولر النظام:
 * - W2: النسخ الاحتياطي/الاستعادة (SUPER_ADMIN فقط — عملية تدميرية).
 * - W3 (نقل من Selim): إعدادات المصنع (SUPER_ADMIN)، التنبيهات الذكية
 *   (كل موثّق — قراءة مجمّعة فقط)، سجل التدقيق (ADMIN+ يرى الكل،
 *   والبقية مدخلاتها)، الأجهزة (register/heartbeat لكل موثّق،
 *   القائمة ADMIN+).
 */
@ApiTags('System (النسخ الاحتياطي والإعدادات والتنبيهات)')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(
    private readonly backupService: BackupService,
    private readonly factorySettingsService: FactorySettingsService,
    private readonly alertsService: AlertsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly devicesService: DevicesService,
  ) {}

  // -------------------------------------------------------------------
  // W2 — النسخ الاحتياطي/الاستعادة
  // -------------------------------------------------------------------

  @Get('backup')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'تنزيل نسخة احتياطية كاملة (JSON بكل الجداول بترتيب FK)',
  })
  async createBackup(@CurrentUser() user: { id: string }) {
    return this.backupService.createBackup(user.id);
  }

  @Get('backup/summary')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'ملخص النسخة الحالية: عدد الجداول والصفوف' })
  async summary() {
    return this.backupService.summary();
  }

  @Post('restore')
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RESTORE_FILE_BYTES } }),
  )
  @ApiOperation({
    summary: `استعادة كاملة — يتطلب عبارة التأكيد "${RESTORE_CONFIRM_PHRASE}" (حقل confirm)`,
  })
  async restore(
    @UploadedFile() file: UploadedBackupFile,
    @Body('confirm') confirm: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new Error('لم يُرفع ملف نسخة احتياطية');
    }
    return this.backupService.restore(file.buffer, confirm, user.id);
  }

  // -------------------------------------------------------------------
  // W3 — إعدادات المصنع (SUPER_ADMIN — تؤثر على الطباعة/التصدير)
  // -------------------------------------------------------------------

  @Get('factory-settings')
  @ApiOperation({
    summary: 'إعدادات المصنع (الهوية/الضريبة/العملة) — يقرأها كل موثّق',
  })
  async getFactorySettings() {
    return this.factorySettingsService.getSettings();
  }

  @Post('factory-settings')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تحديث إعدادات المصنع (جزئي) — SUPER_ADMIN' })
  async updateFactorySettings(
    @Body() dto: UpdateFactorySettingsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.factorySettingsService.update(dto, user.id);
  }

  // -------------------------------------------------------------------
  // W3 — التنبيهات الذكية (كل موثّق)
  // -------------------------------------------------------------------

  @Get('alerts')
  @ApiOperation({
    summary: 'التنبيهات الذكية: مستحقات/غياب/نسخ احتياطي/مبيعات/مصاريف/مخزون',
  })
  async alerts(@CurrentUser() user: { id: string; role: UserRole }) {
    return this.alertsService.getAlerts(user.role);
  }

  // -------------------------------------------------------------------
  // W3 — سجل التدقيق (ADMIN+ كاملًا؛ البقية مدخلاتهم فقط)
  // -------------------------------------------------------------------

  @Get('audit-logs')
  @ApiOperation({
    summary: 'سجل التدقيق بتصفية وترقيم — ADMIN/SUPER_ADMIN يرى الكل',
  })
  async auditLogs(
    @Query() dto: AuditLogsQueryDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.auditLogsService.query(dto, user);
  }

  // -------------------------------------------------------------------
  // W3 — الأجهزة (register/heartbeat لكل موثّق؛ القائمة ADMIN+)
  // -------------------------------------------------------------------

  @Post('devices/register')
  @ApiOperation({ summary: 'تسجيل/تحديث جهاز (upsert على deviceId)' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.devicesService.register(dto, user.id);
  }

  @Post('devices/heartbeat')
  @ApiOperation({ summary: 'نبضة — تحديث آخر ظهور للجهاز المسجل' })
  async heartbeat(
    @Body('deviceId') deviceId: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    return this.devicesService.heartbeat(deviceId ?? '', user.id);
  }

  @Get('devices')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'قائمة الأجهزة المسجلة (أحدث ظهور أولًا)' })
  async devices() {
    return this.devicesService.list();
  }
}
