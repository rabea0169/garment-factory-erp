import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * INV-8 (ب) (P2 — GF-IMP-W3): هدر البضاعة الجاهزة (POST /inventory/
 * movements/waste-finished-good) — المسار الموازي لهدر الخامات: يخفض
 * finished_good_stocks بـ CAS ويرحّل Dr WASTE_EXPENSE / Cr
 * FINISHED_GOOD_STOCK. الكمية عدد صحيح (مطابقة Int لرصيد المنتج التام).
 */
export class WasteFinishedGoodDto {
  @ApiProperty({
    example: 'uuid-of-product-variant',
    description: 'معرف متغير المنتج التام',
  })
  @IsUUID(undefined, { message: 'معرف متغير المنتج يجب أن يكون UUID صالحًا' })
  finishedGoodVariantId: string;

  @ApiProperty({ example: 3, description: 'الكمية الهادرة (عدد صحيح موجب)' })
  @IsInt({ message: 'كمية هدر المنتج التام يجب أن تكون عددًا صحيحًا' })
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 'تلف بالتخزين — رطوبة',
    description: 'سبب الهدر (إلزامي — لا يُقبل هدر بلا سبب موثق)',
  })
  @IsString({ message: 'سبب الهدر يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'سبب الهدر إلزامي — لا يُقبل هدر بلا سبب موثق' })
  reason: string;

  @ApiPropertyOptional({
    example: 'تقرير تالف 09-2026',
    description: 'مرجع المستند — اختياري',
  })
  @IsOptional()
  @IsString({ message: 'المرجع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المرجع لا يمكن أن يكون نصًا فارغًا' })
  reference?: string;
}
