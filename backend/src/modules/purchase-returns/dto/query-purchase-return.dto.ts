import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات قائمة مرتجعات المشتريات (يقلد
 * GET /api/purchase-returns في Selim ERP): بحث نصي في رقم المرتجع/اسم
 * المورد + نطاق تاريخي + فلترة مورد + ترقيم صفحات.
 */
export class QueryPurchaseReturnDto {
  @ApiPropertyOptional({
    example: 'PRR-0001',
    description: 'بحث نصي في رقم المرتجع أو اسم المورد',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'من تاريخ (ISO 8601)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'إلى تاريخ (ISO 8601)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "إلى تاريخ" يجب أن تكون ISO 8601' })
  to?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-supplier',
    description: 'فلترة المورد',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المورد يجب أن يكون UUID صالحًا' })
  supplierId?: string;

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
