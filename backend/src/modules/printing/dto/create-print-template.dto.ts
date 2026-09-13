import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — أنواع مستندات الطباعة المدعومة (نفس قائمة Selim ERP).
 */
export const PRINT_DOCUMENT_TYPES = [
  'INVOICE',
  'PURCHASE',
  'PRODUCTION_ORDER',
  'MATERIAL_ISSUE',
  'RECEIPT',
  'QUOTATION',
  'VOUCHER',
  'CUTTING',
] as const;

/**
 * SELIM-ERP W1 — أحجام الورق المدعومة: حرارية (58mm/80mm) + مكتبية (A4-A6).
 */
export const PRINT_PAPER_SIZES = ['58mm', '80mm', 'A4', 'A5', 'A6'] as const;

/**
 * SELIM-ERP W1 — قنوات الطباعة (نفس قيم Selim):
 * app_pdf = تصدير PDF داخل التطبيق، thermal = طابعة حرارية، external = نظام خارجي.
 */
export const PRINT_CHANNELS = ['app_pdf', 'thermal', 'external'] as const;

/**
 * SELIM-ERP W1 — إنشاء قالب طباعة (يقلد POST /api/printing/templates في Selim).
 *
 * config كائن JSON حر ({ styles, sections, customElements }) — لا يُقيَّد
 * بمخطط صارم لأن رؤية الطباعة تتطور بسرعة في Selim، والخادم يخزّن
 * الإعداد كما هو (مبدأ "القالب بيانات لا كود").
 */
export class CreatePrintTemplateDto {
  @ApiProperty({
    example: 'فاتورة مبيعات — A4 رسمية',
    description: 'اسم القالب (فريد لكل مستند × حجم ورق)',
  })
  @IsString({ message: 'اسم القالب يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم القالب مطلوب' })
  @MaxLength(150, { message: 'اسم القالب يتجاوز 150 حرفًا' })
  name: string;

  @ApiProperty({
    enum: PRINT_DOCUMENT_TYPES,
    description: 'نوع المستند الذي يُطبع بهذا القالب',
  })
  @IsIn(PRINT_DOCUMENT_TYPES, {
    message: 'نوع المستند غير صالح',
  })
  documentType: string;

  @ApiProperty({
    enum: PRINT_PAPER_SIZES,
    description: 'حجم الورق',
  })
  @IsIn(PRINT_PAPER_SIZES, {
    message: 'حجم الورق غير صالح',
  })
  paperSize: string;

  @ApiPropertyOptional({
    example: true,
    description: 'قالب افتراضي لهذا المستند × حجم الورق (واحد فقط لكل زوج)',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isDefault يجب أن يكون قيمة منطقية' })
  isDefault?: boolean;

  @ApiPropertyOptional({
    example: {
      styles: { fontName: 'Cairo', fontSize: 12, direction: 'rtl' },
      sections: ['header', 'items_table', 'totals', 'notes', 'footer'],
      customElements: [],
    },
    description: 'إعداد القالب JSON (أنماط/أقسام/عناصر مخصصة)',
  })
  @IsOptional()
  @IsObject({ message: 'إعداد القالب (config) يجب أن يكون كائن JSON' })
  config?: Record<string, unknown>;
}

/**
 * SELIM-ERP W1 — مرشحات قائمة القوالب (يقلد GET /api/printing/templates):
 * فلترة بنوع المستند/حجم الورق/الحالة + ترقيم.
 */
export class QueryPrintTemplateDto {
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
    enum: PRINT_PAPER_SIZES,
    description: 'فلترة حجم الورق',
  })
  @IsOptional()
  @IsIn(PRINT_PAPER_SIZES, {
    message: 'حجم الورق غير صالح',
  })
  paperSize?: string;

  @ApiPropertyOptional({ example: true, description: 'القوالب النشطة فقط' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isActive يجب أن يكون قيمة منطقية' })
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'رقم الصفحة (≥ 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'الصفحة تبدأ من 1' })
  page?: number;
}
