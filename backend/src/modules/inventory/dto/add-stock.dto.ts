import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

export class AddStockDto {
  @ApiProperty({
    example: 50,
    description: 'الكمية المضافة (يجب أن تكون موجبة)',
  })
  // INV-4: 4 منازل عشرية كحد أقصى — مطابقة Decimal(12,4) لأعمدة الكميات.
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية تقبل حتى 4 منازل عشرية كحد أقصى' },
  )
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 45.5,
    description: 'تكلفة الوحدة (يجب أن تكون موجبة)',
  })
  // INV-4: 2 منزلة عشرية كحد أقصى — مطابقة Decimal(10,2) لـ RawMaterial.costPerUnit.
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'تكلفة الوحدة تقبل منزلتين عشريتين كحد أقصى' },
  )
  @IsPositive({ message: 'تكلفة الوحدة يجب أن تكون رقمًا موجبًا' })
  costPerUnit: number;
}
