import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { ExportsService } from './exports.service';

/**
 * SELIM-ERP W3 — كنترولر التصدير (ExcelExportButton + word-export في
 * Selim ERP): تنزيل Excel/Word لقوائم الكيانات الرئيسية.
 *
 * الجوال ينزّل عبر Dio ويحفظ/يشارك عبر share_plus — الخادم هو مصدر
 * التوليد الوحيد (نفس النمط المؤسسي: تهريب/ترويسة موحدة).
 *
 * الأدوار: تُفحص داخل المعالج لأن المسار واحد لكل الكيانات (:entity)
 * — مرآة أدوار قراءة الوحدة الأصل لكل كيان (INV-2 للمالية)، و
 * SUPER_ADMIN يتجاوز دائمًا (نفس دلالة RolesGuard).
 */

/** أدوار كل كيان — مرآة أدوار قراءة الوحدة الأصل. */
const ENTITY_ROLES: Record<string, UserRole[]> = {
  customers: [UserRole.CASHIER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER],
  suppliers: [
    UserRole.INVENTORY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.GENERAL_MANAGER,
  ],
  products: [
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.CASHIER,
    UserRole.GENERAL_MANAGER,
  ],
  workers: [UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER],
  expenses: [UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER],
  inventory: [
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  ],
  sales: [UserRole.CASHIER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER],
  purchases: [
    UserRole.INVENTORY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.GENERAL_MANAGER,
  ],
};

@ApiTags('Exports (تصدير Excel/Word)')
@Controller('export')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /** أدوار كيان — يعرضها الجوال لإظهار زر التصدير المناسب للدور. */
  static rolesFor(entity: string): UserRole[] | null {
    return ENTITY_ROLES[entity] ?? null;
  }

  private assertAllowed(entity: string, role: UserRole) {
    const allowed = ENTITY_ROLES[entity];
    if (!allowed) return; // الكيان غير المعروف يُرفض في الخدمة (BadRequest).
    if (role === UserRole.SUPER_ADMIN) return;
    if (!allowed.includes(role)) {
      throw new ForbiddenException('دورك لا يملك صلاحية تصدير هذه القائمة');
    }
  }

  @Get('excel/:entity')
  @ApiOperation({
    summary:
      'تصدير قائمة كيان إلى XLSX (ورقة معلومات المصنع + ورقة البيانات RTL)',
  })
  async exportExcel(
    @Param('entity') entity: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertAllowed(entity, user.role);
    const { buffer, filename } = await this.exportsService.exportExcel(entity);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }

  @Get('word/:entity')
  @ApiOperation({
    summary:
      'تصدير قائمة كيان إلى Word .doc (MHTML — نفس أسلوب Selim للتوافق مع MS Word)',
  })
  async exportWord(
    @Param('entity') entity: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Res({ passthrough: true }) res: Response,
    @Query('download') download?: string,
  ) {
    this.assertAllowed(entity, user.role);
    const { content, filename } = await this.exportsService.exportWord(entity);
    res.set({
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': download
        ? `attachment; filename="${filename}"`
        : 'inline',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(Buffer.from(content, 'utf8'));
  }
}
