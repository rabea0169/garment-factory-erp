import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
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
 * SELIM-ERP W1 — بند تسوية الجرد (يقلد InventoryAdjustmentItem في Selim
 * ERP): جرد فعلي (actualQty) يُقارن برصيد النظام فيُحسب الفرق على
 * الخادم — العميل لا يرسل الفرق ولا القيمة أبدًا.
 *
 * البند يشير إلى خامة (rawMaterialId) أو توليفة منتج (productVariantId)
 * — لا كلاهما معًا ولا بلا منهما (نفس نمط XOR في StockLedgerEntry).
 */
export class InventoryAdjustmentItemInputDto {
  @ApiPropertyOptional({
    example: 'uuid-of-raw-material',
    description: 'معرف الخامة (للبنود الخامات — XOR مع productVariantId)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-product-variant',
    description:
      'معرف توليفة المنتج (لبنود البضاعة الجاهزة — XOR مع rawMaterialId)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف التوليفة يجب أن يكون UUID صالحًا' })
  productVariantId?: string;

  @ApiProperty({
    example: 'قماش قطن — أبيض',
    description: 'اسم الصنف (لقطة نصية للعرض في المستند)',
  })
  @IsString()
  @IsNotEmpty({ message: 'اسم الصنف مطلوب في كل بند' })
  @MaxLength(200, { message: 'اسم الصنف يتجاوز 200 حرف' })
  itemName: string;

  @ApiProperty({ example: 'متر', description: 'وحدة القياس (لقطة نصية)' })
  @IsString()
  @IsNotEmpty({ message: 'وحدة القياس مطلوبة في كل بند' })
  @MaxLength(50, { message: 'وحدة القياس تتجاوز 50 حرف' })
  unit: string;

  @ApiProperty({
    example: 98,
    description:
      'الكمية المعدودة فعليًا في الجرد (≥ 0) — يقارنها الخادم برصيد النظام',
  })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية الفعلية يجب أن تكون بأربع منازل عشرية كحد أقصى' },
  )
  @Min(0, { message: 'الكمية الفعلية لا يمكن أن تكون سالبة' })
  actualQty: number;
}

/**
 * SELIM-ERP W1 — إنشاء مسودة تسوية جرد (يقلد POST /api/inventory-
 * adjustments في Selim ERP).
 *
 * القواعد (نفس مسار Selim):
 * - تُنشأ DRAFT بلا أي أثر مالي أو مخزوني — الفروق والمبالغ تُحسب على
 *   الخادم من رصيد النظام الحالي لحظة الإنشاء (لقطة snapshot).
 * - لا تُقبل حالة من الطلب أبدًا: آلة الحالات DRAFT→APPROVED/REJECTED
 *   تُدار من مسارات الاعتماد/الرفض فقط.
 */
export class CreateInventoryAdjustmentDto {
  @ApiProperty({
    example: 'uuid-of-warehouse',
    description: 'معرف المخزن المجرد (إلزامي — التسوية على مستوى مخزن)',
  })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description: 'تاريخ الجرد (افتراضيًا وقت الإنشاء)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة تاريخ الجرد يجب أن تكون ISO 8601' })
  date?: Date;

  @ApiPropertyOptional({
    example: 'جرد ربع سنوي',
    description: 'ملاحظات/سبب التسوية',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'ملاحظات التسوية تتجاوز 500 حرف' })
  notes?: string;

  @ApiProperty({
    type: [InventoryAdjustmentItemInputDto],
    description: 'بنود الجرد (بند واحد على الأقل)',
  })
  @IsArray()
  @IsNotEmpty({ message: 'تسوية الجرد يجب أن تحتوي على بند واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => InventoryAdjustmentItemInputDto)
  items: InventoryAdjustmentItemInputDto[];
}

/**
 * SELIM-ERP W1 — رفض مسودة تسوية (يقلد POST /api/inventory-adjustments/
 * :id/reject): سبب إلزامي — التسوية المرفوضة تحتفظ ببندها للتدقيق.
 */
export class RejectAdjustmentDto {
  @ApiProperty({
    example: 'أعيد الجرد ووُجد تطابق',
    description: 'سبب الرفض (إلزامي)',
  })
  @IsString()
  @IsNotEmpty({ message: 'سبب رفض التسوية مطلوب' })
  @MaxLength(500, { message: 'سبب الرفض يتجاوز 500 حرف' })
  reason: string;
}
