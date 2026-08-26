import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCustomerPaymentDto {
  @ApiProperty({
    example: 228.5,
    description: 'المبلغ المحصل من العميل؛ لا يتجاوز الرصيد المستحق',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'مبلغ التحصيل يجب أن يكون رقمًا صالحًا حتى منزلتين عشريتين' },
  )
  @IsPositive({ message: 'مبلغ التحصيل يجب أن يكون موجبًا' })
  amount: number;

  @ApiProperty({
    example: '00000000-0000-0000-0000-000000000001',
    description: 'الخزينة التي تستقبل التحصيل',
  })
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId: string;

  @ApiPropertyOptional({ example: 'تحصيل دفعة من العميل' })
  @IsOptional()
  @IsString({ message: 'ملاحظات التحصيل يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'ملاحظات التحصيل تتجاوز 500 حرف' })
  notes?: string;
}
