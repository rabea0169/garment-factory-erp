import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PRINT_CHANNELS,
  PRINT_DOCUMENT_TYPES,
  PRINT_PAPER_SIZES,
} from './create-print-template.dto';

/**
 * SELIM-ERP W1 — تسجيل عملية طباعة (يقلد POST /api/printing/log في Selim):
 * من طبع ماذا ومتى وبأي قالب وقناة وكم نسخة وهل هي إعادة طباعة.
 *
 * الخادم يلتقط (snapshot) اسم المستخدم واسم القالب لحظة الطباعة —
 * السجل يبقى مقروءًا حتى لو حُذف القالب أو تغيّر اسم المستخدم لاحقًا
 * (نفس فلسفة لقطات Selim).
 */
export class LogPrintDto {
  @ApiProperty({
    enum: PRINT_DOCUMENT_TYPES,
    description: 'نوع المستند المطبوع',
  })
  @IsIn(PRINT_DOCUMENT_TYPES, {
    message: 'نوع المستند غير صالح',
  })
  documentType: string;

  @ApiPropertyOptional({
    example: 'uuid-of-invoice',
    description: 'معرف المستند المطبوع (اختياري)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المستند يجب أن يكون UUID صالحًا' })
  documentId?: string;

  @ApiPropertyOptional({
    example: 'INV-2026-0007',
    description: 'رقم المستند (لقطة نصية)',
  })
  @IsOptional()
  @IsString({ message: 'رقم المستند يجب أن يكون نصًا' })
  @MaxLength(100, { message: 'رقم المستند يتجاوز 100 حرف' })
  documentNumber?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-template',
    description: 'معرف القالب المستخدم (إن وُجد — يُتحقق من وجوده)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف القالب يجب أن يكون UUID صالحًا' })
  templateId?: string;

  @ApiProperty({
    enum: PRINT_CHANNELS,
    description: 'قناة الطباعة',
  })
  @IsIn(PRINT_CHANNELS, {
    message: 'قناة الطباعة غير صالحة',
  })
  channel: string;

  @ApiPropertyOptional({
    enum: PRINT_PAPER_SIZES,
    description: 'حجم الورق المستخدم (يفترض من القالب إن لم يُرسل)',
  })
  @IsOptional()
  @IsIn(PRINT_PAPER_SIZES, {
    message: 'حجم الورق غير صالح',
  })
  paperSize?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'عدد النسخ (1-99)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'عدد النسخ يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'عدد النسخ ≥ 1' })
  @Max(99, { message: 'عدد النسخ ≤ 99' })
  copies?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'هل هي إعادة طباعة لمستند طُبع من قبل؟',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isReprint يجب أن يكون قيمة منطقية' })
  isReprint?: boolean;
}

/**
 * SELIM-ERP W1 — مرشحات سجل الطباعة (يقلد GET /api/printing/log):
 * فلترة بنوع المستند/المستخدم/نطاق زمني + ترقيم — عرض تدقيق إداري.
 */
export class QueryPrintLogDto {
  @ApiPropertyOptional({
    enum: PRINT_DOCUMENT_TYPES,
    description: 'فلترة نوع المستند',
  })
  @IsOptional()
  @IsIn(PRINT_DOCUMENT_TYPES, {
    message: 'نوع المستند غير صالح',
  })
  documentType?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-user',
    description: 'فلترة بالمستخدم الطابعة',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المستخدم يجب أن يكون UUID صالحًا' })
  userId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'من تاريخ' })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'إلى تاريخ' })
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
}
