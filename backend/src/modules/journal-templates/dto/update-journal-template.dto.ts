import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  JournalTemplateLineDto,
  RECURRENCE_PATTERNS,
} from './create-journal-template.dto';

/**
 * SELIM-ERP W1 — تعديل قالب قيد (يقلد PATCH /api/journal-templates/:id):
 * تعيين جزئي — عند إرسال lines تُطبَّق كل تحققات التوازن على البنود الجديدة
 * (بندين على الأقل، سطر مدين أو دائن لا الاثنين، مجموع متساوٍ).
 */
export class UpdateJournalTemplateDto {
  @ApiPropertyOptional({
    example: 'قيد إيجار المعرض الشهري (محدّث)',
    description: 'الاسم الجديد (فريد)',
  })
  @IsOptional()
  @IsString({ message: 'اسم القالب يجب أن يكون نصًا' })
  @MaxLength(150, { message: 'اسم القالب يتجاوز 150 حرفًا' })
  name?: string;

  @ApiPropertyOptional({
    example: 'يُرحَّل أول يوم عمل من كل شهر',
    description: 'الوصف الجديد',
  })
  @IsOptional()
  @IsString({ message: 'وصف القالب يجب أن يكون نصًا' })
  @MaxLength(500, { message: 'وصف القالب يتجاوز 500 حرف' })
  description?: string;

  @ApiPropertyOptional({
    type: [JournalTemplateLineDto],
    description: 'البنود الجديدة كاملة (تُستبدل بالكامل عند الإرسال)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2, {
    message: 'القالب يجب أن يحتوي على بندين على الأقل',
  })
  @ArrayMaxSize(200, { message: 'القالب لا يمكن أن يتجاوز 200 بند' })
  @ValidateNested({ each: true })
  @Type(() => JournalTemplateLineDto)
  lines?: JournalTemplateLineDto[];

  @ApiPropertyOptional({ example: true, description: 'قالب متكرر؟' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isRecurring يجب أن يكون قيمة منطقية' })
  isRecurring?: boolean;

  @ApiPropertyOptional({
    enum: RECURRENCE_PATTERNS,
    description: 'نمط التكرار',
  })
  @IsOptional()
  @IsIn(RECURRENCE_PATTERNS, {
    message: 'نمط التكرار يجب أن يكون weekly أو monthly أو yearly',
  })
  recurrencePattern?: string;
}
