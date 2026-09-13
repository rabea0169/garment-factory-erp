import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * SELIM-ERP W1 — بند عرض السعر (يقلد QuotationItem): الصنف بروابط
 * اختيارية (منتج/توليفة) + لقطة اسم نصية — العرض يبقى مقروءًا حتى لو
 * حُذف المنتج لاحقًا (نفس فلسفة لقطات Selim).
 */
export class QuotationItemInputDto {
  @ApiPropertyOptional({
    example: 'uuid-of-product',
    description: 'معرف المنتج (اختياري — عرض سعر لصنف غير مسجل بعد)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المنتج يجب أن يكون UUID صالحًا' })
  productId?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-variant',
    description: 'معرف التوليفة SKU (اختياري — يلزم للتحويل لأمر بيع)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف التوليفة يجب أن يكون UUID صالحًا' })
  productVariantId?: string;

  @ApiProperty({ example: 'تيشيرت بولو — أحمر / L', description: 'اسم الصنف' })
  @IsString()
  @IsNotEmpty({ message: 'اسم الصنف مطلوب في كل بند' })
  productName: string;

  @ApiProperty({ example: 10, description: 'الكمية (موجبة)' })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية يجب أن تكون بأربع منازل عشرية كحد أقصى' },
  )
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({ example: 250, description: 'سعر الوحدة (موجب)' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'سعر الوحدة يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @IsPositive({ message: 'سعر الوحدة يجب أن يكون رقمًا موجبًا' })
  unitPrice: number;

  @ApiPropertyOptional({ example: 'تطريز خاص', description: 'ملاحظات البند' })
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * SELIM-ERP W1 — إنشاء عرض سعر (يقلد POST /api/quotations في Selim ERP).
 *
 * الإجمالي يُحسبه الخادم من البنود (نفس قاعدة المجال في أوامر البيع:
 * العميل يرسل البنود والخصم ونسبة VAT فقط — لا يرسل إجماليًا).
 */
export class CreateQuotationDto {
  @ApiPropertyOptional({
    example: 'uuid-of-customer',
    description: 'معرف العميل المسجل (اختياري — قد يكون عميلًا جديدًا نصًا)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العميل يجب أن يكون UUID صالحًا' })
  customerId?: string;

  @ApiProperty({ example: 'شركة النور للتجارة', description: 'اسم العميل' })
  @IsString()
  @IsNotEmpty({ message: 'اسم العميل مطلوب' })
  customerName: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'تاريخ سريان العرض (null = بدون صلاحية)',
  })
  @IsOptional()
  validUntil?: Date;

  @ApiProperty({
    example: 0,
    description: 'الخصم (رقم ≥ 0) — يُخصم من المجموع قبل الضريبة',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'الخصم يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'الخصم لا يمكن أن يكون سالبًا' })
  @Max(1_000_000_000, { message: 'الخصم يتجاوز الحد المسموح' })
  discount: number;

  @ApiProperty({
    example: 0.14,
    description: 'نسبة VAT كسر عشري (0.14 = 14%) — افتراضيًا 0',
  })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'نسبة الضريبة يجب أن تكون بأربع منازل عشرية كحد أقصى' },
  )
  @Min(0, { message: 'نسبة الضريبة لا يمكن أن تكون سالبة' })
  @Max(1, { message: 'نسبة الضريبة لا يمكن أن تتجاوز 100%' })
  vatRate: number;

  @ApiProperty({
    type: [QuotationItemInputDto],
    description: 'بنود العرض (بند واحد على الأقل)',
  })
  @IsArray()
  @IsNotEmpty({ message: 'عرض السعر يجب أن يحتوي على بند واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => QuotationItemInputDto)
  items: QuotationItemInputDto[];

  @ApiPropertyOptional({
    example: 'عرض تجريبي لجهة معينة',
    description: 'ملاحظات',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  // createdById من الجلسة (@CurrentUser) — لا يقبل من body.
  // quotationNo يولده الخادم عبر SequenceService — لا يقبل من body.
}
