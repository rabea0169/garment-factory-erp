import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
