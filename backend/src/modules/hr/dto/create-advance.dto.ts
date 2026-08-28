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

  // COMM-F05 / ACC-F02: عند توفير treasuryId تُخصم قيمة السلفة من الخزينة
  // ويُرحَّل قيد مزدوج (Dr Worker Advances / Cr Cash) داخل نفس tx. عند
  // غياب treasuryId تُسجَّل السلفة كأصل مستحق فقط دون قيد نقدي (مثال: سلفة
  // معلَّقة بانتظار الصرف).
  @ApiPropertyOptional({
    example: 'uuid-of-treasury',
    description:
      'معرف الخزينة المصروف منها (اختياري، يفعّل ترحيل القيد النقدي)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;
}
