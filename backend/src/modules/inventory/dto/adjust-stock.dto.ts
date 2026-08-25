import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  NotEquals,
} from 'class-validator';

/**
 * GF-0007: تسوية جرد — فرق موقّع (±) بين الرصيد الدفتري والجرد الفعلي.
 * السبب إلزامي (تسوية بلا سبب = إخلال بالتدقيق)، ويُرفض أيضًا أي تسوية
 * تُظهر الرصيد لقيمة سالبة (ADR-0007).
 */
export class AdjustStockDto {
  @ApiProperty({ example: 'uuid-of-raw-material', description: 'معرف الخامة' })
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiProperty({ example: 'uuid-of-warehouse', description: 'معرف المخزن' })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiProperty({
    example: -3.5,
    description: 'الفرق الموقّع (±) — سالب يعني نقص جرد، موجب يعني زيادة',
  })
  @IsNumber({}, { message: 'الفرق يجب أن يكون رقمًا' })
  @NotEquals(0, { message: 'فرق التسوية لا يمكن أن يكون صفرًا' })
  quantityDelta: number;

  @ApiProperty({
    example: 'جرد شهري أغسطس — عجز قطع',
    description: 'سبب التسوية (إلزامي للتدقيق)',
  })
  @IsString({ message: 'سبب التسوية يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'سبب التسوية إلزامي — لا تُقبل تسوية بلا سبب موثق' })
  reason: string;

  @ApiProperty({
    example: 'جرد دوري',
    description: 'مرجع المستند — اختياري',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'المرجع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المرجع لا يمكن أن يكون نصًا فارغًا' })
  reference?: string;
}
