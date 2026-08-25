import { ApiProperty } from '@nestjs/swagger';
import { IsPositive } from 'class-validator';

export class AddStockDto {
  @ApiProperty({
    example: 50,
    description: 'الكمية المضافة (يجب أن تكون موجبة)',
  })
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 45.5,
    description: 'تكلفة الوحدة (يجب أن تكون موجبة)',
  })
  @IsPositive({ message: 'تكلفة الوحدة يجب أن تكون رقمًا موجبًا' })
  costPerUnit: number;
}
