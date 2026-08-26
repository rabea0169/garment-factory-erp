import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PurchaseReceiptItemDto {
  @ApiProperty({ example: 'uuid-of-purchase-order-item' })
  @IsUUID(undefined, { message: 'معرف بند أمر الشراء يجب أن يكون UUID صالحًا' })
  purchaseOrderItemId: string;

  @ApiProperty({ example: 25 })
  @Type(() => Number)
  @IsInt({ message: 'كمية الاستلام يجب أن تكون عددًا صحيحًا' })
  @IsPositive({ message: 'كمية الاستلام يجب أن تكون أكبر من صفر' })
  quantity: number;
}

export class CreatePurchaseReceiptDto {
  @ApiProperty({ type: [PurchaseReceiptItemDto] })
  @IsArray()
  @ArrayNotEmpty({
    message: 'يجب أن يحتوي إذن الاستلام على بند واحد على الأقل',
  })
  @ValidateNested({ each: true })
  @Type(() => PurchaseReceiptItemDto)
  items: PurchaseReceiptItemDto[];

  @ApiPropertyOptional({ example: 'استلام جزئي للدفعة الأولى' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  notes?: string;
}
