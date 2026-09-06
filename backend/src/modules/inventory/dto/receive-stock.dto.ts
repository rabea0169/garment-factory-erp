import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * GF-0007: استلام خامات في مخزن — الحركة الوحيدة التي تعيد احتساب
 * التكلفة بمتوسط مرجح (ADR-0008) وتحدّث costPerUnit للخامة.
 */
export class ReceiveStockDto {
  @ApiProperty({ example: 'uuid-of-raw-material', description: 'معرف الخامة' })
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiProperty({ example: 'uuid-of-warehouse', description: 'معرف المخزن' })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiProperty({ example: 50, description: 'الكمية المستلمة (موجبة)' })
  // INV-4: 4 منازل عشرية كحد أقصى — مطابقة Decimal(12,4) لعمود quantityDelta.
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية تقبل حتى 4 منازل عشرية كحد أقصى' },
  )
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 48,
    description: 'تكلفة الوحدة لهذه الشحنة (موجبة) — تُدمج بمتوسط مرجح',
  })
  // INV-4: 2 منزلة عشرية كحد أقصى — مطابقة Decimal(10,2) لـ RawMaterial.costPerUnit
  // (متوسط التكلفة المرجح يقبل أيضًا المنزلتين)؛ 10 منازل ترفض بـ 400 قبل GL.
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'تكلفة الوحدة تقبل منزلتين عشريتين كحد أقصى' },
  )
  @IsPositive({ message: 'تكلفة الوحدة يجب أن تكون رقمًا موجبًا' })
  unitCost: number;

  @ApiProperty({
    example: 'PO-2026-001',
    description: 'مرجع المستند (أمر شراء/فاتورة) — اختياري',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'المرجع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المرجع لا يمكن أن يكون نصًا فارغًا' })
  reference?: string;

  @ApiProperty({
    example: 'شحنة قماش جديدة من المورد',
    description: 'ملاحظات — اختياري',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  notes?: string;
}
