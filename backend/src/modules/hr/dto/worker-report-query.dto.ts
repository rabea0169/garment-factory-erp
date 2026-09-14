import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * SELIM-ERP W5 — مدخلات تقرير العامل (نقل worker-report من المرجع):
 * نطاق تاريخ اختياري بصيغة YYYY-MM-DD (أو ISO كامل). غياب الحدين =
 * كل التاريخ. التحقق الصارم من الترتيب (من ≤ إلى) يتم في الخدمة —
 * نفس رسائل الخطأ العربية للمرجع.
 */
export class WorkerReportQueryDto {
  @ApiPropertyOptional({
    description: 'بداية الفترة (YYYY-MM-DD أو ISO)',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  from?: string;

  @ApiPropertyOptional({
    description: 'نهاية الفترة (YYYY-MM-DD أو ISO)',
    example: '2026-09-30',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  to?: string;
}
