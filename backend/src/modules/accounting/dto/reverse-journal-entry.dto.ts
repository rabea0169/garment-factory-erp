import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A9: DTO لعكس قيد مالي.
 *
 * - description: وصف اختياري يُستخدم بدلًا من "عكس قيد CODE" الافتراضي.
 *   يُسمح بـ 500 حرف كحد أقصى (anti-abuse).
 *
 * ملاحظة: لا يُسمح بتمرير originalEntryId في body — يُؤخذ من مسار URL فقط
 * (P0-04) — يمنع التلاعب بمحتوى الطلب عبر تمرير ID مختلف.
 */
export class ReverseJournalEntryDto {
  @ApiPropertyOptional({
    description: 'وصف اختياري للقيد العكسي (افتراضي: "عكس قيد CODE")',
    example: 'إلغاء قيد بيع آجل بالخطأ — مرتجع عميل',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
