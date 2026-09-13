import { ApiPropertyOptional } from '@nestjs/swagger';
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
 * SELIM-ERP W1 — مرشحات قائمة أوامر القص (يقلد GET /api/cutting في
 * Selim ERP): الحالة + المنتج + العامل + نطاق زمني + ترقيم.
 */
export class QueryCuttingOrderDto {
  @ApiPropertyOptional({
    enum: ['DRAFT', 'ACTIVE', 'REVERSED'],
    description: 'فلترة الحالة',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'REVERSED'], {
    message: 'حالة أمر القص غير صالحة',
  })
  status?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-product',
    description: 'فلترة الموديل المقصوص',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المنتج يجب أن يكون UUID صالحًا' })
  productId?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-worker',
    description: 'فلترة عامل القص',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'من تاريخ' })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'إلى تاريخ' })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "إلى تاريخ" يجب أن تكون ISO 8601' })
  to?: string;

  @ApiPropertyOptional({ example: 1, description: 'رقم الصفحة (≥ 1)' })
  @IsOptional()
  @IsInt({ message: 'الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'الصفحة تبدأ من 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'حجم الصفحة (1-100)' })
  @IsOptional()
  @IsInt({ message: 'حجم الصفحة يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'حجم الصفحة ≥ 1' })
  @Max(100, { message: 'حجم الصفحة ≤ 100' })
  limit?: number;
}
