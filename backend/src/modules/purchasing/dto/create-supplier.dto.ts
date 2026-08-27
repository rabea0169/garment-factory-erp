import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSupplierDto {
  @ApiProperty({ example: 'شركة النسيج المتحدة', description: 'اسم المورد' })
  @IsString()
  @IsNotEmpty({ message: 'اسم المورد مطلوب' })
  name: string;

  @ApiPropertyOptional({ example: '01000000000', description: 'رقم الهاتف' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: 'supplier@example.com',
    description: 'البريد الإلكتروني',
  })
  @IsOptional()
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  email?: string;

  @ApiPropertyOptional({ example: 'القاهرة', description: 'العنوان' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'توريد أقمشة قطنية', description: 'ملاحظات' })
  @IsOptional()
  @IsString()
  notes?: string;
}
