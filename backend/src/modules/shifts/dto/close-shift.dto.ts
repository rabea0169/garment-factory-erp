import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — DTO إغلاق وردية (يقلد POST /api/shifts/:id/close في Selim ERP).
 *
 * الكاشير يُدخل النقدية الفعلية المعدودة في الدرج، والخادم يحسب المتوقع
 * والفرق — لا يقبل العميل أي قيمة محسوبة (نفس قاعدة المجال المشتركة).
 */
export class CloseShiftDto {
  @ApiProperty({
    example: 3500.5,
    description: 'النقدية الفعلية عند الإغلاق (≥ 0)',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'رصيد الإغلاق يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0, { message: 'رصيد الإغلاق لا يمكن أن يكون سالبًا' })
  @Max(1_000_000_000, { message: 'رصيد الإغلاق يتجاوز الحد المسموح' })
  endCash: number;

  @ApiPropertyOptional({
    example: 'فرق عُزى لمردود عميل',
    description: 'ملاحظات الإغلاق (تُلحق بملاحظات الوردية)',
  })
  @IsOptional()
  @IsString({ message: 'ملاحظات الإغلاق يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'ملاحظات الإغلاق لا تتجاوز 500 حرف' })
  notes?: string;
}
