import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات قائمة كشوف الرواتب المجمدة (يقلد GET
 * /api/payroll-statements في Selim ERP): فلترة الحالة + نطاق فترة
 * (تداخل مع فترة الكشف) + ترقيم.
 */
export class QueryPayrollStatementDto {
  @ApiPropertyOptional({
    enum: ['DRAFT', 'POSTED'],
    description: 'فلترة الحالة',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'POSTED'], { message: 'حالة الكشف المجمع غير صالحة' })
  status?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'حد أدنى لتداخل الفترة (من)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'حد أعلى لتداخل الفترة (إلى)',
  })
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
