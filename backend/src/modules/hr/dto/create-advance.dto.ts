import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAdvanceDto {
  @ApiProperty({ example: 'uuid-of-worker', description: 'معرف العامل' })
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId: string;

  @ApiProperty({
    example: 200,
    description: 'مبلغ السلفة (يجب أن يكون موجبًا)',
  })
  @IsPositive({ message: 'مبلغ السلفة يجب أن يكون رقمًا موجبًا' })
  amount: number;

  @ApiPropertyOptional({
    example: 'سلفة شهرية',
    description: 'ملاحظات (اختياري)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;
}
