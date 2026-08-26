import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ConfirmSalesOrderDto {
  @ApiPropertyOptional({
    description:
      'معرف الخزينة المطلوبة للبيع النقدي؛ إلزامي عند paymentType=CASH',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;
}
