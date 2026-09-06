import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { QualityKpiQueryDto } from './quality-kpi-query.dto';

/**
 * QLT-3 (P1 — GF-IMP-W2): مرشحات قائمة فحوص الجودة.
 *
 * يعيد استخدام حقول quality-kpi-query.dto نفسها (stage / workOrderId /
 * from / to) — بنفس القيود والرسائل — ويضيف ترقيم الصفحات. التطبيق في
 * getQualityChecks يستخدم الفهارس القائمة (workOrderId+stage) و(checkedAt).
 */
export class QualityCheckQueryDto extends QualityKpiQueryDto {
  @ApiPropertyOptional({
    description: 'رقم الصفحة (الافتراضي 1)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'عدد العناصر في الصفحة (الافتراضي 20، الأقصى 100)',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
