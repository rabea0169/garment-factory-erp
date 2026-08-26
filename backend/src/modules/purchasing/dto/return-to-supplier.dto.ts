import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsUUID,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReturnToSupplierDto {
  @IsNotEmpty()
  @IsUUID()
  purchaseOrderItemId: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
