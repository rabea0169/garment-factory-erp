import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsUUID,
  IsOptional,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';

export class ReturnToSupplierDto {
  @IsNotEmpty()
  @IsUUID()
  purchaseOrderItemId: string;

  @IsNotEmpty()
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية يجب أن تكون رقمًا بـ 4 منازل عشرية كحد أقصى' },
  )
  @IsPositive()
  @Max(1_000_000_000, { message: 'الكمية تتجاوز الحد المسموح' })
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
