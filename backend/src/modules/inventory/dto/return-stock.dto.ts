import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * INV-8 (أ) (P2 — GF-IMP-W3): إرجاع خامات من الإنتاج (POST /inventory/return)
 * — يزيد الرصيد بقيده في الدفتر بنوع RETURN وبلا قيد GL (مرتجع داخلي
 * بلا طرف خارجي — ADR-0020). حقول التكليف الحرفية: rawMaterialId/
 * quantity/reason إلزامية وreference اختياري؛ warehouseId اختياري إضافي
 * — غيابه يُحلّ لمخزن الخامات الافتراضي الحتمي (INV-6) داخل الخدمة.
 * الكمية حتى 4 منازل (مطابقة Decimal(12,4)).
 */
export class ReturnStockDto {
  @ApiProperty({ example: 'uuid-of-raw-material', description: 'معرف الخامة' })
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiPropertyOptional({
    example: 'uuid-of-warehouse',
    description:
      'معرف المخزن — اختياري: غيابه يوجّه الإرجاع لمخزن الخامات الافتراضي الحتمي (INV-6)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId?: string;

  @ApiProperty({ example: 12.5, description: 'الكمية المرتجعة (موجبة)' })
  // INV-4: 4 منازل عشرية كحد أقصى — مطابقة Decimal(12,4) لعمود quantityDelta.
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية تقبل حتى 4 منازل عشرية كحد أقصى' },
  )
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 'بقايا قص من مرحلة القص',
    description: 'سبب الإرجاع (إلزامي — لا يُقبل مرتجع بلا سبب موثق)',
  })
  @IsString({ message: 'سبب الإرجاع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'سبب الإرجاع إلزامي — لا يُقبل مرتجع بلا سبب موثق' })
  reason: string;

  @ApiPropertyOptional({
    example: 'WO-20260901-ABCD1234',
    description: 'مرجع المستند (أمر التشغيل المصدر) — اختياري',
  })
  @IsOptional()
  @IsString({ message: 'المرجع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المرجع لا يمكن أن يكون نصًا فارغًا' })
  reference?: string;
}
