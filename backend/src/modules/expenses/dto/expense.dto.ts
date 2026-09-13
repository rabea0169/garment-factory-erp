import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — إنشاء مصروف (يقلد POST /api/expenses في Selim ERP).
 *
 * قاعدة المجال (من Selim وتُنفَّذ حرفيًا): المصروف مع خزينة = سحب نقدي
 * + قيد مالي في عملية ذرّية واحدة (Dr GENERAL_EXPENSE / Cr CASH مع
 * خصم رصيد الخزينة داخل نفس المعاملة). المصروف بلا خزينة = سجل بسيط
 * بلا قيد — لا استحقاق وهمي (نفس سلوك Selim حيث القيد يصاحب السحب فقط).
 */
export class CreateExpenseDto {
  @ApiProperty({
    example: 'uuid-of-expense-category',
    description: 'معرف بند المصروف (إلزامي — الاسم لقطة منه)',
  })
  @IsUUID(undefined, { message: 'معرف بند المصروف يجب أن يكون UUID صالحًا' })
  categoryId: string;

  @ApiProperty({
    example: 1500,
    description: 'قيمة المصروف (موجبة) — تُقرَّب لمنزلتين على الخادم',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'قيمة المصروف يجب أن تكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0.01, { message: 'قيمة المصروف يجب أن تكون أكبر من صفر' })
  @Max(1_000_000_000, { message: 'قيمة المصروف تتجاوز الحد المسموح' })
  amount: number;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description: 'تاريخ المصروف (افتراضيًا وقت الإنشاء)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة تاريخ المصروف يجب أن تكون ISO 8601' })
  date?: Date;

  @ApiPropertyOptional({
    example: 'فاتورة كهرباء سبتمبر',
    description: 'ملاحظات/وصف المصروف',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'ملاحظات المصروف تتجاوز 500 حرف' })
  notes?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-treasury',
    description:
      'معرف الخزينة المسحوب منها (اختياري — عند وجوده: خصم الرصيد + قيد مالي داخل معاملة واحدة؛ عند غيابه: سجل بلا قيد)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;
}

/**
 * SELIM-ERP W1 — تعديل مصروف (يقلد PATCH /api/expenses/:id):
 * مسموح فقط للمصروفات غير المقيدة ماليًا (بلا خزينة) — المصروف المسحوب
 * من خزينة له قيد ورصيد متأثران فتعديله كسر للذاتية المحاسبية.
 */
export class UpdateExpenseDto {
  @ApiPropertyOptional({
    example: 'uuid-of-expense-category',
    description: 'معرف بند المصروف الجديد (يعيد لقطة الاسم)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف بند المصروف يجب أن يكون UUID صالحًا' })
  categoryId?: string;

  @ApiPropertyOptional({ example: 2000, description: 'القيمة الجديدة (موجبة)' })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'قيمة المصروف يجب أن تكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0.01, { message: 'قيمة المصروف يجب أن تكون أكبر من صفر' })
  amount?: number;

  @ApiPropertyOptional({ example: '2026-09-12', description: 'التاريخ الجديد' })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة تاريخ المصروف يجب أن تكون ISO 8601' })
  date?: Date;

  @ApiPropertyOptional({ example: 'ملاحظة محدثة', description: 'ملاحظات' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'ملاحظات المصروف تتجاوز 500 حرف' })
  notes?: string;
}

/**
 * SELIM-ERP W1 — بند مصروف (يقلد ExpenseCategory): اسم فريد + ملاحظات.
 */
export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'صيانة', description: 'اسم البند (فريد)' })
  @IsString()
  @IsNotEmpty({ message: 'اسم بند المصروف مطلوب' })
  @MaxLength(100, { message: 'اسم البند يتجاوز 100 حرف' })
  name: string;

  @ApiPropertyOptional({
    example: 'صيانة آلات ومباني',
    description: 'ملاحظات البند',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'ملاحظات البند تتجاوز 500 حرف' })
  notes?: string;
}

/**
 * SELIM-ERP W1 — تعديل بند مصروف: الاسم الفريد يُحفظ عند التغيير.
 */
export class UpdateExpenseCategoryDto {
  @ApiPropertyOptional({
    example: 'نقل ومواصلات',
    description: 'الاسم الجديد (فريد)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'اسم بند المصروف لا يمكن أن يكون فارغًا' })
  @MaxLength(100, { message: 'اسم البند يتجاوز 100 حرف' })
  name?: string;

  @ApiPropertyOptional({
    example: 'ملاحظة محدثة',
    description: 'ملاحظات البند',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'ملاحظات البند تتجاوز 500 حرف' })
  notes?: string;
}

/**
 * SELIM-ERP W1 — مرشحات قائمة المصروفات: بحث نصي في الملاحظات/اسم البند
 * + فلترة بند + نطاق تاريخي + ترقيم صفحات.
 */
export class QueryExpenseDto {
  @ApiPropertyOptional({
    example: 'كهرباء',
    description: 'بحث نصي في الملاحظات أو اسم البند',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-expense-category',
    description: 'فلترة البند',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف بند المصروف يجب أن يكون UUID صالحًا' })
  categoryId?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'من تاريخ (ISO 8601)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'إلى تاريخ (ISO 8601)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "إلى تاريخ" يجب أن تكون ISO 8601' })
  to?: string;

  @ApiPropertyOptional({ example: 1, description: 'رقم الصفحة (≥ 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'الصفحة تبدأ من 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'حجم الصفحة (1-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'حجم الصفحة يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'حجم الصفحة ≥ 1' })
  @Max(100, { message: 'حجم الصفحة ≤ 100' })
  limit?: number;

  @ApiPropertyOptional({
    enum: ['amount', 'date'],
    description: 'ترتيب افتراضي بالتاريخ الأحدث — للتوثيق فقط',
  })
  @IsOptional()
  @IsIn(['amount', 'date'], { message: 'خيار ترتيب غير مدعوم' })
  sortBy?: string;
}
