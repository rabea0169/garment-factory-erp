import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
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
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 48,
    description: 'تكلفة الوحدة لهذه الشحنة (موجبة) — تُدمج بمتوسط مرجح',
  })
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
