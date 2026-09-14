import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { DataImportService } from './data-import.service';
import { ImportCommitDto } from './dto/import-commit.dto';

/** شكل ملف multer المرفوع (بلا @types/multer — الحد الأدنى المستخدم). */
export interface UploadedImportFile {
  buffer: Buffer;
  originalname?: string;
  size?: number;
}

/** حد حجم ملف الاستيراد — 5MB يغطي آلاف الصفوف. */
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/**
 * SELIM-ERP W2 — كنترولر الاستيراد (ImportWizard في Selim ERP).
 *
 * الأدوار: اتحاد أدوار إنشاء الكيانات الأربعة على مستوى الـ guard، ثم
 * تحقق الكيان المحدد داخل الخدمة (دور كل كيان = مرآة وحدته الأصل).
 */
@ApiTags('Data Import (معالج الاستيراد)')
@Controller('import')
export class DataImportController {
  constructor(private readonly importService: DataImportService) {}

  @Get('entities')
  @ApiOperation({ summary: 'الكيانات القابلة للاستيراد وأعمدتها ودور إنشائها' })
  describeEntities() {
    return this.importService.describeEntities();
  }

  /** SELIM-ERP W3 — تنزيل قالب الاستيراد (XLSX بأوراق الكيانات الأربعة). */
  @Get('template')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.PRODUCTION_MANAGER,
    UserRole.CASHIER,
    UserRole.INVENTORY_MANAGER,
    UserRole.HR_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'تنزيل قالب الاستيراد XLSX (ورقة RTL لكل كيان برؤوس الأعمدة)',
  })
  async downloadTemplate(@Res({ passthrough: true }) res: Response) {
    const buffer = await this.importService.generateTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="import_template.xlsx"',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }

  @Post('preview')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.PRODUCTION_MANAGER,
    UserRole.CASHIER,
    UserRole.HR_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }),
  )
  @ApiOperation({
    summary: 'معاينة ملف CSV/XLSX — تحليل وتحقق صف-بصف بلا أي كتابة',
  })
  async preview(
    @UploadedFile() file: UploadedImportFile,
    @Query('entity') entity: string = 'products',
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      return {
        entityType: entity,
        headers: [],
        unmappedHeaders: [],
        missingRequiredColumns: [],
        rows: [],
        validCount: 0,
        invalidCount: 0,
        error: 'لم يُرفع ملف',
      };
    }
    return this.importService.preview(
      file.buffer,
      file.originalname,
      entity,
      user.role,
    );
  }

  @Post('commit')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.PRODUCTION_MANAGER,
    UserRole.CASHIER,
    UserRole.HR_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'مفتاح ثابت لدفعة الاستيراد — إعادة الإرسال لا تستورد مرتين',
  })
  @ApiOperation({
    summary: 'تنفيذ الصفوف الصالحة داخل معاملة واحدة — تحقق خادمي مجدد',
  })
  async commit(
    @Body() dto: ImportCommitDto,
    @CurrentUser() user: { id: string; role: UserRole },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.importService.commit(
      dto.entityType,
      dto.rows,
      user.id,
      user.role,
      idempotencyKey,
    );
  }
}
