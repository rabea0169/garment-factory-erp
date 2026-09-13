import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * SELIM-ERP W1 — ترحيل قالب قيد (يقلد POST /api/journal-templates/:id/post
 * في Selim ERP): تاريخ اختياري للقيد + ملاحظات اختيارية تُدمج في وصف
 * القيد الناتج. القيد الحقيقي يُنشأ عبر FinancialPostingService (محرك
 * القيد المزدوج الموحد) ثم يُحدَّث lastUsedAt على القالب.
 */
export class PostJournalTemplateDto {
  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00.000Z',
    description: 'تاريخ القيد (افتراضي: الآن)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ القيد يجب أن يكون بصيغة ISO 8601 صالحة' })
  date?: string;

  @ApiPropertyOptional({
    example: 'إيجار سبتمبر 2026',
    description: 'ملاحظات تشخيصية تُدمج في وصف القيد',
  })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @MaxLength(300, { message: 'الملاحظات تتطلب 300 حرف' })
  notes?: string;
}
