import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateCustomerPaymentDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000001' })
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({ example: '00000000-0000-0000-0000-000000000002' })
  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @ApiProperty({ example: 500, description: 'قيمة الدفعة بالجنيه' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'دفعة جزئية' })
  @IsOptional()
  @IsString()
  notes?: string;
}
