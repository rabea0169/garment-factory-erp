import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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

  @ApiPropertyOptional({
    example: 'customer@example.com',
    description: 'البريد الإلكتروني (اختياري)',
  })
  @IsOptional()
  @IsString()
  email?: string;

  // Wave 6 — COMM-F07: حد ائتماني اختياري للعميل.
  // NULL = لا حد ائتماني (سلوك تاريخي). أي قيمة موجبة تمنع تأكيد طلب آجل
  // يتجاوز (الرصيد المعلَّق + قيمة الطلب الجديد) الحد.
  @ApiPropertyOptional({
    example: 50000,
    description:
      'الحد الائتماني الأقصى بالجنيه (NULL = لا حد). يُفحَص عند تأكيد أمر البيع الآجل.',
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'الحد الائتماني لا يمكن أن يكون سالبًا' })
  creditLimit?: number;

  @ApiPropertyOptional({
    example: 30,
    description:
      'شروط السداد الآجل بالأيام (0 = فوري، 30 = آجل شهر). حقل معلوماتي اليوم.',
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'شروط السداد لا يمكن أن تكون سالبة' })
  creditTermsDays?: number;
}
