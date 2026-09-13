import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * SELIM-ERP W1 — DTO توليد كشف رواتب مجمع (يقلد POST /api/payroll-statements
 * في Selim ERP): تجميع كشوف شهر كامل في مستند واحد بلقطة JSON مجمدة.
 */
export class GeneratePayrollStatementDto {
  @ApiProperty({
    example: '2026-09-01',
    description: 'بداية فترة الكشف المجمع (ISO 8601)',
  })
  @IsDateString({}, { message: 'صيغة بداية الفترة يجب أن تكون ISO 8601' })
  periodFrom: string;

  @ApiProperty({
    example: '2026-09-30',
    description: 'نهاية فترة الكشف المجمع (ISO 8601)',
  })
  @IsDateString({}, { message: 'صيغة نهاية الفترة يجب أن تكون ISO 8601' })
  periodTo: string;

  @ApiPropertyOptional({
    example: 'رواتب سبتمبر 2026',
    description: 'ملاحظات',
  })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'الملاحظات لا تتجاوز 500 حرف' })
  notes?: string;
}
