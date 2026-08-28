import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Wave 6 — COMM-F07: DTO لتحديث الحد الائتماني وشروط السداد لعميل موجود.
 *
 * جميع الحقول اختيارية؛ يُكتفى بإرسال ما يحتاج التحديث فقط.
 * creditLimit: إرسال null صراحةً يزيل الحد (يصبح "لا حد ائتماني").
 * creditTermsDays: 0 يعني فوري.
 */
export class UpdateCustomerCreditDto {
  @ApiPropertyOptional({
    example: 75000,
    description:
      'الحد الائتماني الجديد بالجنيه. null = لا حد ائتماني. أي قيمة غير سالبة مسموحة.',
    type: Number,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'الحد الائتماني لا يمكن أن يكون سالبًا' })
  creditLimit?: number | null;

  @ApiPropertyOptional({
    example: 45,
    description: 'شروط السداد الآجل الجديدة بالأيام.',
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'شروط السداد لا يمكن أن تكون سالبة' })
  creditTermsDays?: number;
}

/**
 * DTO لتحديث بيانات العميل العامة (الاسم والاتصال).
 * لا يسمح بتعديل balance أو code (تُدار من مسارات مالية مخصصة).
 */
export class UpdateCustomerDto {
  @ApiPropertyOptional({
    example: 'مصنع النور المحدّث',
    description: 'اسم العميل',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '01000000000', description: 'رقم الهاتف' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'الجيزة', description: 'العنوان' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    example: 'customer@example.com',
    description: 'البريد الإلكتروني',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: 'ملاحظات محدثة', description: 'ملاحظات' })
  @IsOptional()
  @IsString()
  notes?: string;
}
