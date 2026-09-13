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
 * SELIM-ERP W1 — إنشاء حركة خزينة (يقلد POST /api/treasury-transactions
 * في Selim ERP): إيداع / سحب / تحويل بين خزينتين.
 *
 * القواعد (من Selim وتُنفَّذ حرفيًا):
 * - الترقيم TRT-0001 على الخادم داخل معاملة الإنشاء.
 * - الأرصدة تتغير داخل نفس المعاملة: إيداع + / سحب − / تحويل (مصدر −
 *   وهدف +) — السحب والتحويل بحراسة رصيد كافٍ (تحديث شرطي ذري).
 * - التحويل يشترط خزينة مستهدفة مختلفة وبنفس العملة (أو كلتاهما بلا
 *   عملة) — لا تحويل بين خزائن بعملات مختلفة.
 */
export class CreateTreasuryTransactionDto {
  @ApiProperty({
    example: 'uuid-of-treasury',
    description: 'معرف الخزينة (المصدر في التحويل)',
  })
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId: string;

  @ApiPropertyOptional({
    example: 'uuid-of-target-treasury',
    description:
      'معرف الخزينة المستهدفة — للتحويل فقط (يجب أن تختلف عن المصدر)',
  })
  @IsOptional()
  @IsUUID(undefined, {
    message: 'معرف الخزينة المستهدفة يجب أن يكون UUID صالحًا',
  })
  toTreasuryId?: string;

  @ApiProperty({
    enum: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'],
    description: 'نوع الحركة: إيداع / سحب / تحويل',
  })
  @IsIn(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'], {
    message: 'نوع الحركة يجب أن يكون DEPOSIT أو WITHDRAWAL أو TRANSFER',
  })
  type: string;

  @ApiProperty({
    example: 5000,
    description: 'المبلغ (موجب) — يُقرَّب لمنزلتين على الخادم',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'المبلغ يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  @Max(1_000_000_000, { message: 'المبلغ يتجاوز الحد المسموح' })
  amount: number;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description: 'تاريخ الحركة (افتراضيًا وقت الإنشاء)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة تاريخ الحركة يجب أن تكون ISO 8601' })
  date?: Date;

  @ApiProperty({
    example: 'إيداع مبيعات اليوم',
    description: 'وصف الحركة (إلزامي — كل حركة نقدية موثقة بوصف)',
  })
  @IsString()
  @IsNotEmpty({ message: 'وصف الحركة مطلوب' })
  @MaxLength(500, { message: 'وصف الحركة يتجاوز 500 حرف' })
  description: string;

  @ApiPropertyOptional({
    example: 'مبيعات',
    description:
      'فئة الحركة (مبيعات / رأس مال / قرض / مشتريات / رواتب / إيجار / أخرى) — تحدد الحساب المقابل في القيد',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'فئة الحركة تتجاوز 100 حرف' })
  category?: string;

  @ApiPropertyOptional({ example: 'سند رقم 45', description: 'ملاحظات' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'ملاحظات الحركة تتجاوز 500 حرف' })
  notes?: string;
}

/**
 * SELIM-ERP W1 — مرشحات قائمة حركات الخزينة (يقلد GET /api/treasury-
 * transactions): فلترة خزينة/نوع + نطاق تاريخي + ترقيم صفحات.
 */
export class QueryTreasuryTransactionDto {
  @ApiPropertyOptional({
    example: 'uuid-of-treasury',
    description: 'فلترة الخزينة (المصدر)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;

  @ApiPropertyOptional({
    enum: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'],
    description: 'فلترة النوع',
  })
  @IsOptional()
  @IsIn(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'], {
    message: 'نوع الحركة غير صالح',
  })
  type?: string;

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
  @IsInt({ message: 'حجم الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'حجم الصفحة ≥ 1' })
  @Max(100, { message: 'حجم الصفحة ≤ 100' })
  limit?: number;
}
