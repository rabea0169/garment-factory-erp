import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات التقارير المالية ذات النطاق الزمني
 * (يقلد GET /api/financial-reports/* في Selim ERP).
 *
 * القاعدة المشتركة (تُفرض في الخدمة): من < إلى، وإلا رفض برسالة
 * عربية. النطاق مطلوب لدقة التقرير — عند الغياب يفترض الشهر الحالي
 * (نفس convention فترات التقارير في Selim).
 */
export class ReportRangeQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'من تاريخ (افتراضي: أول الشهر الحالي)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'إلى تاريخ (افتراضي: الآن)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "إلى تاريخ" يجب أن تكون ISO 8601' })
  to?: string;
}

/**
 * SELIM-ERP W1 — تقرير لحظي (asOf): الميزانية العمومية وأعمار الذمم —
 * الرصيد لحظة معينة لا حركة نطاق. افتراضيًا: الآن.
 */
export class AsOfQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'تاريخ التقييم (افتراضي: الآن)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة تاريخ التقييم يجب أن تكون ISO 8601' })
  asOf?: string;
}

/**
 * SELIM-ERP W1 — تقرير أعمار الذمم: AR (عملاء — مدينون) أو AP
 * (موردون — دائنون)، افتراضيًا AR.
 */
export class AgingQueryDto extends AsOfQueryDto {
  @ApiPropertyOptional({
    enum: ['AR', 'AP'],
    description: 'نوع الذمم: عملاء (AR) أو موردون (AP) — افتراضي AR',
  })
  @IsOptional()
  @Type(() => String)
  @IsIn(['AR', 'AP'], { message: 'نوع الذمم يجب أن يكون AR أو AP' })
  type?: string;
}
