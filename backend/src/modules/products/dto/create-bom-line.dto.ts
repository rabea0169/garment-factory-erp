import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateBomLineDto {
  @ApiProperty({ example: 'uuid-of-raw-material', description: 'معرف الخامة' })
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiProperty({ example: 1.25, description: 'كمية الخامة لكل وحدة منتج' })
  @IsPositive({ message: 'كمية الخامة يجب أن تكون موجبة' })
  quantity: number;

  @ApiProperty({ example: 'METER', description: 'وحدة القياس' })
  @IsString()
  @IsNotEmpty({ message: 'وحدة القياس مطلوبة' })
  unit: string;
}
