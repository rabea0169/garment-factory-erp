import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات قائمة العبوات (يقلد GET /api/packing في Selim ERP):
 * إظهار المعطلة اختياريًا + ترقيم صفحات.
 */
export class QueryPackDto {
  @ApiPropertyOptional({
    example: false,
    description: 'تضمين العبوات المعطلة (الافتراضي: النشطة فقط)',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'includeInactive يجب أن يكون قيمة منطقية' })
  includeInactive?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'رقم الصفحة (≥ 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'الصفحة تبدأ من 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'حجم الصفحة (1-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'حجم الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'حجم الصفحة ≥ 1' })
  @Max(100, { message: 'حجم الصفحة ≤ 100' })
  limit?: number;
}
