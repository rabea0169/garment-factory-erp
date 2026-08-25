import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'عميل جديد', description: 'اسم العميل' })
  @IsString()
  @IsNotEmpty({ message: 'اسم العميل مطلوب' })
  name: string;

  @ApiPropertyOptional({
    example: '01000000000',
    description: 'رقم الهاتف (اختياري)',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'القاهرة', description: 'العنوان (اختياري)' })
  @IsOptional()
  @IsString()
  address?: string;
}
