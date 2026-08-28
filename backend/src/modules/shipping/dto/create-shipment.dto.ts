import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateShipmentDto {
  @ApiProperty({
    example: 'uuid-of-sales-order',
    description: 'معرف أمر البيع المشحون',
  })
  @IsUUID(undefined, { message: 'معرف أمر البيع يجب أن يكون UUID صالحًا' })
  salesOrderId: string;

  @ApiPropertyOptional({
    example: 'uuid-of-shipping-company',
    description: 'معرف شركة الشحن (اختياري)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف شركة الشحن يجب أن يكون UUID صالحًا' })
  shippingCompanyId?: string;

  @ApiPropertyOptional({
    example: 75,
    description: 'تكلفة الشحن (رقم ≥ 0، اختياري)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'تكلفة الشحن لا يمكن أن تكون سالبة' })
  shippingCost?: number;

  @ApiPropertyOptional({
    example: 'uuid-of-treasury',
    description:
      'معرف الخزينة المصروف منها الشحن (اختياري). عند توفيره مع shippingCost > 0 يُرحَّل قيد Dr Shipping Expense / Cr Cash.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'عند true (مع shippingCost > 0 وغياب treasuryId) يُرحَّل قيد Dr Shipping Expense / Cr Accounts Payable (استحقاق على شركة الشحن). افتراضي false.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  accrueToPayable?: boolean;

  @ApiPropertyOptional({
    example: 'TRK-99',
    description: 'رقم التتبع (اختياري)',
  })
  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @ApiPropertyOptional({
    example: 'تسليم صباحي',
    description: 'ملاحظات (اختياري)',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
