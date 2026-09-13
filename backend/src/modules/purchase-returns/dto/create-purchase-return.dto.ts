import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * SELIM-ERP W1 — بند مرتجع المشتريات (يقلد PurchaseReturnItem في Selim ERP).
 *
 * البند يرتبط بأمر الشراء إما عبر بند الأصل (purchaseOrderItemId) أو عبر
 * الخامة مباشرة (rawMaterialId)، والاسم لقطة نصية تبقى مقروءة حتى لو
 * حُذفت الخامة لاحقًا (نفس فلسفة لقطات Selim).
 */
export class PurchaseReturnItemInputDto {
  @ApiPropertyOptional({
    example: 'uuid-of-purchase-order-item',
    description:
      'معرف بند أمر الشراء الأصل (اختياري — يربط المرتجع ببند الشراء)',
  })
  @IsOptional()
  @IsUUID(undefined, {
    message: 'معرف بند أمر الشراء يجب أن يكون UUID صالحًا',
  })
  purchaseOrderItemId?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-raw-material',
    description: 'معرف الخامة المرتجعة (يُستكمل من بند أمر الشراء عند غيابه)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId?: string;

  @ApiPropertyOptional({
    example: 'قماش قطن 100%',
    description: 'اسم الخامة (لقطة — يُستكمل من بند الشراء/الخامة عند غيابه)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'اسم الخامة لا يمكن أن يكون فارغًا' })
  @MaxLength(200, { message: 'اسم الخامة يتجاوز 200 حرف' })
  rawMaterialName?: string;

  @ApiProperty({ example: 10, description: 'الكمية المرتجعة للمورد (موجبة)' })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية يجب أن تكون بأربع منازل عشرية كحد أقصى' },
  )
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 120.5,
    description: 'سعر وحدة الاسترداد المتفق عليه مع المورد (موجب)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'سعر الوحدة يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @IsPositive({ message: 'سعر الوحدة يجب أن يكون رقمًا موجبًا' })
  unitPrice: number;

  @ApiPropertyOptional({
    example: 110,
    description: 'تكلفة الوحدة الدفترية للخامة (تُستكمل من الخامة عند غيابه)',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'تكلفة الوحدة يجب أن تكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'تكلفة الوحدة لا يمكن أن تكون سالبة' })
  unitCost?: number;

  @ApiPropertyOptional({
    example: 'عيب في الجودة',
    description: 'سبب إرجاع هذا البند',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'سبب البند يتجاوز 500 حرف' })
  reason?: string;
}

/**
 * SELIM-ERP W1 — إنشاء مرتجع مشتريات (يقلد POST /api/purchase-returns
 * في Selim ERP).
 *
 * قاعدة المجال (نفس نمط عروض الأسعار/أوامر البيع): العميل يرسل البنود
 * والخصم والضريبة فقط — المجموع والإجمالي يحسبهما الخادم من البنود ولا
 * يُقبلان من الطلب أبدًا. الترقيم PRR-0001 يولده الخادم داخل معاملة
 * الإنشاء نفسها.
 */
export class CreatePurchaseReturnDto {
  @ApiProperty({
    example: 'uuid-of-purchase-order',
    description: 'معرف أمر الشراء الأصل (إلزامي — المرتجع يصدر عنه)',
  })
  @IsUUID(undefined, { message: 'معرف أمر الشراء يجب أن يكون UUID صالحًا' })
  purchaseOrderId: string;

  @ApiProperty({
    type: [PurchaseReturnItemInputDto],
    description: 'بنود المرتجع (بند واحد على الأقل)',
  })
  @IsArray()
  @IsNotEmpty({
    message: 'مرتجع المشتريات يجب أن يحتوي على بند واحد على الأقل',
  })
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnItemInputDto)
  items: PurchaseReturnItemInputDto[];

  @ApiPropertyOptional({
    example: '2026-09-10',
    description: 'تاريخ المرتجع (افتراضيًا وقت الإنشاء)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة تاريخ المرتجع يجب أن تكون ISO 8601' })
  date?: Date;

  @ApiPropertyOptional({
    example: 0,
    description: 'خصم على المرتجع (≥ 0) — يُخصم من مجموع البنود قبل الضريبة',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'الخصم يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'خصم المرتجع لا يمكن أن يكون سالبًا' })
  @Max(1_000_000_000, { message: 'خصم المرتجع يتجاوز الحد المسموح' })
  discountAmount?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'ضريبة مرتجعة (≥ 0) — تُضاف للصافي وتُعكس على VAT_PAYABLE',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'الضريبة يجب أن تكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'ضريبة المرتجع لا يمكن أن تكون سالبة' })
  taxAmount?: number;

  @ApiPropertyOptional({
    example: 'اختلاف المقاسات',
    description: 'سبب المرتجع ككل',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'سبب المرتجع يتجاوز 500 حرف' })
  reason?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'هل تُرجع الكميات فعليًا من المخزون؟ (true = حركة صرف من المخزن — الافتراضي؛ false = خصم مالي بلا حركة مخزون)',
  })
  @IsOptional()
  @IsBoolean({ message: 'restockItems يجب أن تكون قيمة منطقية' })
  restockItems?: boolean;

  @ApiProperty({
    example: 'credit',
    enum: ['credit', 'cash'],
    description:
      'طريقة الاسترداد: credit = إشعار دائن يخصم رصيد المورد (الافتراضي)؛ cash = استرداد نقدي من المورد',
  })
  @IsOptional()
  @IsIn(['credit', 'cash'], {
    message: 'طريقة الاسترداد يجب أن تكون credit أو cash',
  })
  refundMethod?: string;

  @ApiPropertyOptional({
    example: 'مرتجع فصيلة 45',
    description: 'ملاحظات عامة',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'الملاحظات تتجاوز 1000 حرف' })
  notes?: string;

  // الإجماليات (subtotal/total) تُحسب على الخادم من البنود — لا تُقبل من body.
  // returnNumber يولده الخادم عبر SequenceService داخل المعاملة — لا يقبل من body.
  // supplierId/supplierName لقطتان من أمر الشراء — لا يقبلان من body.
}
