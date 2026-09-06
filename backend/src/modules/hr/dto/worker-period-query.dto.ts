import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * HR-6 (ج) (GF-IMP-W3): مرشحات قراءات الجوال المشتركة بين السلف والإنتاج
 * اليومي — كلها اختيارية: العامل، أمر التشغيل (للإنتاج)، ونطاق التاريخ.
 */
export class WorkerPeriodQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000001',
    description: 'تصفية بعامل محدد',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId?: string;

  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000002',
    description: 'تصفية بأمر تشغيل محدد (سجلات الإنتاج فقط)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف أمر التشغيل يجب أن يكون UUID صالحًا' })
  workOrderId?: string;

  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'من تاريخ (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'إلى تاريخ (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;
}
