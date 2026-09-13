import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

/**
 * SELIM-ERP W1 — بناء/تفكيك عبوات (يقلد POST /api/packing/:id/build و
 * /unpack في Selim ERP): عدد العبوات المطلوبة من المخزن المحدد.
 */
export class BuildPackDto {
  @ApiProperty({
    example: 'uuid-of-warehouse',
    description: 'مخزن المنتج التام الذي تُخصم منه المكونات',
  })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiProperty({ example: 5, description: 'عدد العبوات (عدد صحيح ≥ 1)' })
  @IsInt({ message: 'عدد العبوات يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'عدد العبوات يجب أن يكون 1 على الأقل' })
  count: number;
}
