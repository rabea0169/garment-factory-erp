import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
} from 'class-validator';

export class CreateAdvanceDto {
  @ApiProperty({ example: 'uuid-of-worker', description: 'معرف العامل' })
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId: string;

  @ApiProperty({
    example: 200,
    description: 'مبلغ السلفة (يجب أن يكون موجبًا، منزلتان عشريتان كحد أقصى)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'مبلغ السلفة يجب أن يكون برقم موجب بمنزلتين عشريتين كحد أقصى' },
  )
  @IsPositive({ message: 'مبلغ السلفة يجب أن يكون رقمًا موجبًا' })
  @Max(1_000_000_000, { message: 'مبلغ السلفة يتجاوز الحد المسموح' })
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
