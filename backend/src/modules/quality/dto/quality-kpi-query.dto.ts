import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionStage } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * GF-0014: مرشحات تجميع مؤشرات الجودة — لا تحتوي pagination لأن النتيجة
 * aggregate واحدة، وتُحسب من QualityCheck المكتمل فقط.
 */
export class QualityKpiQueryDto {
  @ApiPropertyOptional({
    enum: ProductionStage,
    example: ProductionStage.SEWING,
    description: 'تصفية بمرحلة إنتاج محددة',
  })
  @IsOptional()
  @IsEnum(ProductionStage, { message: 'المرحلة غير صالحة' })
  stage?: ProductionStage;

  @ApiPropertyOptional({
    example: 'uuid-of-work-order',
    description: 'تصفية بأمر تشغيل محدد',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف أمر التشغيل يجب أن يكون UUID صالحًا' })
  workOrderId?: string;

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00Z',
    description: 'بداية الفترة حسب checkedAt (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59Z',
    description: 'نهاية الفترة حسب checkedAt (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;
}
