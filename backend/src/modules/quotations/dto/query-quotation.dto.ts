import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { IsDateString } from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات قائمة عروض الأسعار (يقلد GET /api/quotations):
 * بحث نصي في اسم العميل/رقم العرض + نطاق تاريخي + فلترة حالة + ترقيم.
 */
export class QueryQuotationDto {
  @ApiPropertyOptional({
    example: 'النور',
    description: 'بحث نصي في اسم العميل أو رقم العرض',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED'],
    description: 'فلترة الحالة',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED'], {
    message: 'حالة العرض غير صالحة',
  })
  status?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'من تاريخ' })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' },
  )
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'إلى تاريخ' })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'صيغة "إلى تاريخ" يجب أن تكون ISO 8601' },
  )
  to?: string;

  @ApiPropertyOptional({ example: 'uuid-of-customer', description: 'فلتر العميل' })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العميل يجب أن يكون UUID صالحًا' })
  customerId?: string;

  @ApiPropertyOptional({ example: 1, description: 'رقم الصفحة (≥ 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'الصفحة تبدأ من 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'حجم الصفحة (1-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'حجم الصفحة يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'حجم الصفحة ≥ 1' })
  @Max(100, { message: 'حجم الصفحة ≤ 100' })
  limit?: number;
}

/**
 * SELIM-ERP W1 — انتقال حالة العرض (يقلد PATCH /api/quotations/:id):
 * المسارات المسموحة فقط — الحالة لا تُضبط مباشرة أبدًا (نفس مبدأ
 * آلة الحالات في أوامر الإنتاج الحالية).
 */
export class UpdateQuotationStatusDto {
  @ApiPropertyOptional({
    enum: ['SENT', 'ACCEPTED', 'REJECTED'],
    description: 'الإجراء: إرسال / قبول / رفض',
  })
  @IsIn(['SENT', 'ACCEPTED', 'REJECTED'], {
    message: 'الإجراء يجب أن يكون SENT أو ACCEPTED أو REJECTED',
  })
  action: string;
}
