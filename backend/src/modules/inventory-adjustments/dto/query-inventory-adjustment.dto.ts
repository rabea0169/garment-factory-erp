import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات قائمة تسويات الجرد (يقلد GET /api/inventory-
 * adjustments في Selim ERP): فلترة حالة/مخزن + نطاق تاريخي + ترقيم.
 */
export class QueryInventoryAdjustmentDto {
  @ApiPropertyOptional({
    enum: ['DRAFT', 'APPROVED', 'REJECTED'],
    description: 'فلترة الحالة',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'APPROVED', 'REJECTED'], {
    message: 'حالة التسوية غير صالحة',
  })
  status?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-warehouse',
    description: 'فلترة المخزن',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId?: string;

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
