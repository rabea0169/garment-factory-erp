import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsNumber,
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

  // PUR-2: الكميات الكسرية مسموحة حتى 4 منازل — عمود بند الشراء
  // Decimal(10,4) فكان IsInt يجعل استلام الكميات الكسرية مستحيلًا.
  // (سياسة الكميات في أمر الشراء نفسها صارت كسرية عبر PUR-1 فتتسق المساران.)
  @ApiProperty({
    example: 2.5,
    description: 'كمية الاستلام — رقم موجب بحد أقصى 4 منازل عشرية',
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'كمية الاستلام يجب أن تكون رقمًا بحد أقصى 4 منازل عشرية' },
  )
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
