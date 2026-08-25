import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateSalesOrderItemDto {
  @ApiProperty({
    example: 'uuid-of-variant',
    description: 'معرف الـ variant (SKU)',
  })
  @IsUUID(undefined, { message: 'معرف الـ variant يجب أن يكون UUID صالحًا' })
  productVariantId: string;

  @ApiProperty({ example: 2, description: 'الكمية (عدد صحيح موجب)' })
  @IsInt({ message: 'الكمية يجب أن تكون عددًا صحيحًا' })
  @IsPositive({ message: 'الكمية يجب أن تكون عددًا موجبًا' })
  quantity: number;

  @ApiProperty({ example: 100, description: 'سعر الوحدة (يجب أن يكون موجبًا)' })
  @IsPositive({ message: 'سعر الوحدة يجب أن يكون رقمًا موجبًا' })
  unitPrice: number;
}
