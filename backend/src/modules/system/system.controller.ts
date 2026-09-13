import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { BackupService, RESTORE_CONFIRM_PHRASE } from './backup.service';

/** شكل ملف multer المرفوع (بلا @types/multer — الحد الأدنى المستخدم). */
interface UploadedBackupFile {
  buffer: Buffer;
  originalname?: string;
  size?: number;
}

/** حد ملف الاستعادة — 200MB يستوعب نسخًا كبيرة جدًا (activity_logs). */
const MAX_RESTORE_FILE_BYTES = 200 * 1024 * 1024;

/**
 * SELIM-ERP W2 — كنترولر النسخ الاحتياطي/الاستعادة (Backup.tsx في Selim).
 *
 * SUPER_ADMIN فقط — عملية تدميرية/امتيازية بحتة (الاستعادة تستبدل كل
 * بيانات النظام) — لا دور آخر يقترب منها.
 */
@ApiTags('System (النسخ الاحتياطي)')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(private readonly backupService: BackupService) {}

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
}
