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

export class PurchaseReturnItemDto {
  @ApiProperty({ example: 'uuid-of-purchase-order-item' })
  @IsUUID(undefined, { message: 'معرف بند أمر الشراء يجب أن يكون UUID صالحًا' })
  purchaseOrderItemId: string;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt({ message: 'كمية المرتجع يجب أن تكون عددًا صحيحًا' })
  @IsPositive({ message: 'كمية المرتجع يجب أن تكون أكبر من صفر' })
  quantity: number;
}

export class CreatePurchaseReturnDto {
  @ApiProperty({ type: [PurchaseReturnItemDto] })
  @IsArray()
  @ArrayNotEmpty({
    message: 'يجب أن يحتوي المرتجع على بند واحد على الأقل',
  })
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnItemDto)
  items: PurchaseReturnItemDto[];

  @ApiPropertyOptional({ example: 'مرتجع بسبب تلف في الخامات' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  notes?: string;
}
