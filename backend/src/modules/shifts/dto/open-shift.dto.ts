import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — DTO فتح وردية (يقلد POST /api/shifts/open في Selim ERP).
 *
 * الوردية مستند رقابة نقدية (POS): يفتحها الكاشير برصيد افتتاحي اختياري
 * وتُغلق برصيد فعلي يُقارن بالمتوقع — كل الحسابات على الخادم.
 */
export class OpenShiftDto {
  @ApiPropertyOptional({
    example: 500,
    description: 'رصيد النقدية الافتتاحي في الدرج (≥ 0)',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'رصيد الافتتاح يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'رصيد الافتتاح لا يمكن أن يكون سالبًا' })
  @Max(1_000_000_000, { message: 'رصيد الافتتاح يتجاوز الحد المسموح' })
  startCash?: number;

  @ApiPropertyOptional({ example: 'وردية صباحية', description: 'ملاحظات' })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'الملاحظات لا تتجاوز 500 حرف' })
  notes?: string;
}
