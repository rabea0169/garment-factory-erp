import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * SELIM-ERP W1 — أنماط التكرار المعتمدة لقالب القيد (مطابقة لتعليق
 * JournalTemplate.recurrencePattern في prisma/schema.prisma).
 */
export const RECURRENCE_PATTERNS = ['weekly', 'monthly', 'yearly'] as const;

/**
 * SELIM-ERP W1 — بند قالب القيد (يقلد JournalTemplateLine في Selim ERP):
 * حساب + مدين أو دائن (أحدهما فقط > 0) + وصف اختياري.
 *
 * البند يخزّن اتجاهه (مدين/دائن) كما في دفاتر Selim — لا أزواجًا جاهزة،
 * لأن القالب يُحرَّر بالمحاسب والاقتران يحدث عند الترحيل فقط.
 */
export class JournalTemplateLineDto {
  @ApiProperty({
    example: '40000000-0000-0000-0000-000000000011',
    description: 'معرف الحساب (يجب أن يكون حسابًا ورقة غير تجميعي)',
  })
  // 'loose': يقبل الحسابات النظامية الثابتة version-0 (راجع JournalLineDto)
  @IsUUID('loose', { message: 'معرف الحساب يجب أن يكون UUID صالحًا' })
  accountId: string;

  @ApiPropertyOptional({
    example: 2500,
    description: 'المبلغ المدين (0 إن كان السطر دائنًا)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'المبلغ المدين يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'المبلغ المدين لا يمكن أن يكون سالبًا' })
  debit?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'المبلغ الدائن (0 إن كان السطر مدينًا)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'المبلغ الدائن يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'المبلغ الدائن لا يمكن أن يكون سالبًا' })
  credit?: number;

  @ApiPropertyOptional({
    example: 'إيجار المعرض — الشهر الحالي',
    description: 'وصف السطر (يظهر في القيد المُرحَّل)',
  })
  @IsOptional()
  @IsString({ message: 'وصف السطر يجب أن يكون نصًا' })
  @MaxLength(200, { message: 'وصف السطر يتجاوز 200 حرف' })
  description?: string;
}

/**
 * SELIM-ERP W1 — إنشاء قالب قيد متكرر (يقلد POST /api/journal-templates
 * في Selim ERP): قيود جاهزة (الإيجار الشهري/رواتب/عمولات...) تُرحَّل
 * بنقرة واحدة عبر POST :id/post.
 *
 * قواعد التوازن (تُفرض في الخدمة أيضًا — الدفاع المزدوج):
 * بندين على الأقل، وكل سطر مدين أو دائن (لا الاثنين)، ومجموع المدين =
 * مجموع الدائن.
 */
export class CreateJournalTemplateDto {
  @ApiProperty({
    example: 'قيد إيجار المعرض الشهري',
    description: 'اسم القالب (فريد)',
  })
  @IsString({ message: 'اسم القالب يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم القالب مطلوب' })
  @MaxLength(150, { message: 'اسم القالب يتجاوز 150 حرفًا' })
  name: string;

  @ApiPropertyOptional({
    example: 'يُرحَّل أول يوم عمل من كل شهر',
    description: 'وصف القالب',
  })
  @IsOptional()
  @IsString({ message: 'وصف القالب يجب أن يكون نصًا' })
  @MaxLength(500, { message: 'وصف القالب يتجاوز 500 حرف' })
  description?: string;

  @ApiProperty({
    type: [JournalTemplateLineDto],
    description: 'بنود القالب (بندان على الأقل — متوازنة مدين/دائن)',
  })
  @IsArray()
  @ArrayMinSize(2, {
    message: 'القالب يجب أن يحتوي على بندين على الأقل',
  })
  @ArrayMaxSize(200, { message: 'القالب لا يمكن أن يتجاوز 200 بند' })
  @ValidateNested({ each: true })
  @Type(() => JournalTemplateLineDto)
  lines: JournalTemplateLineDto[];

  @ApiPropertyOptional({
    example: true,
    description: 'قالب متكرر (يظهر في فلاتر المتكررة)',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isRecurring يجب أن يكون قيمة منطقية' })
  isRecurring?: boolean;

  @ApiPropertyOptional({
    enum: RECURRENCE_PATTERNS,
    description: 'نمط التكرار (عند isRecurring=true)',
  })
  @IsOptional()
  @IsIn(RECURRENCE_PATTERNS, {
    message: 'نمط التكرار يجب أن يكون weekly أو monthly أو yearly',
  })
  recurrencePattern?: string;
}
