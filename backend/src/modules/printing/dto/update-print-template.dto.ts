import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  PRINT_DOCUMENT_TYPES,
  PRINT_PAPER_SIZES,
} from './create-print-template.dto';

/**
 * SELIM-ERP W1 — تعديل قالب طباعة (يقلد PATCH /api/printing/templates/:id).
 *
 * كل الحقول اختيارية — التعيين الجزئي فقط. تعيين isDefault=true يُطبّق
 * قاعدة Selim: قالب افتراضي واحد لكل (مستند × حجم ورق) — الخدمة تُزيل
 * الافتراضية عن بقية قوالب الزوج داخل نفس المعاملة.
 */
export class UpdatePrintTemplateDto {
  @ApiPropertyOptional({
    example: 'فاتورة مبيعات — A4 مختصرة',
    description: 'الاسم الجديد للقالب',
  })
  @IsOptional()
  @IsString({ message: 'اسم القالب يجب أن يكون نصًا' })
  @MaxLength(150, { message: 'اسم القالب يتجاوز 150 حرفًا' })
  name?: string;

  @ApiPropertyOptional({
    enum: PRINT_DOCUMENT_TYPES,
    description: 'نوع المستند الجديد',
  })
  @IsOptional()
  @IsIn(PRINT_DOCUMENT_TYPES, {
    message: 'نوع المستند غير صالح',
  })
  documentType?: string;

  @ApiPropertyOptional({
    enum: PRINT_PAPER_SIZES,
    description: 'حجم الورق الجديد',
  })
  @IsOptional()
  @IsIn(PRINT_PAPER_SIZES, {
    message: 'حجم الورق غير صالح',
  })
  paperSize?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'تعيينه افتراضيًا للزوج (يزيل الافتراضية عن غيره)',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isDefault يجب أن يكون قيمة منطقية' })
  isDefault?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'تنشيط/تعطيل القالب (الحذف = تعطيل)',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isActive يجب أن يكون قيمة منطقية' })
  isActive?: boolean;

  @ApiPropertyOptional({
    example: { styles: { fontSize: 14 } },
    description: 'إعداد القالب JSON الجديد (يُستبدل بالكامل)',
  })
  @IsOptional()
  @IsObject({ message: 'إعداد القالب (config) يجب أن يكون كائن JSON' })
  config?: Record<string, unknown>;
}
