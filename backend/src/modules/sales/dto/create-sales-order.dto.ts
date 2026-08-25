import { ApiProperty } from '@nestjs/swagger';
import { PaymentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateSalesOrderItemDto } from './create-sales-order-item.dto';

export class CreateSalesOrderDto {
  @ApiProperty({ example: 'uuid-of-customer', description: 'معرف العميل' })
  @IsUUID(undefined, { message: 'معرف العميل يجب أن يكون UUID صالحًا' })
  customerId: string;

  @ApiProperty({
    enum: PaymentType,
    example: PaymentType.CASH,
    description: 'نوع الدفع',
  })
  @IsEnum(PaymentType, {
    message: 'نوع الدفع يجب أن يكون CASH أو CREDIT أو PARTIAL',
  })
  paymentType: PaymentType;

  @ApiProperty({ example: 0, description: 'الخصم (رقم ≥ 0)' })
  @IsNumber()
  @Min(0, { message: 'الخصم لا يمكن أن يكون سالبًا' })
  discount: number;

  @ApiProperty({
    type: [CreateSalesOrderItemDto],
    description: 'بنود الأمر (بند واحد على الأقل)',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'أمر البيع يجب أن يحتوي على بند واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderItemDto)
  items: CreateSalesOrderItemDto[];

  // ملاحظة P0-04: userId لا يقبل من العميل — من الجلسة (@CurrentUser).
  // الإجمالي يحسبه الخادم — لا يقبل totalAmount من body (قاعدة المجال).
}
