import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * GF-0007: تسجيل هدر/تالف — كمية سالبة في الـ ledger بتكلفة الخامة الحالية
 * (متوسط مرجح)، والسبب إلزامي لأن الهدر بقة بلا سبب = ثغرة تدقيق.
 */
export class WasteStockDto {
  @ApiProperty({ example: 'uuid-of-raw-material', description: 'معرف الخامة' })
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiProperty({ example: 'uuid-of-warehouse', description: 'معرف المخزن' })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiProperty({ example: 2.5, description: 'الكمية الهادرة (موجبة)' })
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 'قماش مبلل تالف بالمخزن',
    description: 'سبب الهدر (إلزامي)',
  })
  @IsString({ message: 'سبب الهدر يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'سبب الهدر إلزامي — لا يُقبل هدر بلا سبب موثق' })
  reason: string;

  @ApiProperty({
    example: 'تقرير تالف 08-2026',
    description: 'مرجع المستند — اختياري',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'المرجع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المرجع لا يمكن أن يكون نصًا فارغًا' })
  reference?: string;
}
