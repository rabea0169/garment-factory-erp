import { ApiPropertyOptional } from '@nestjs/swagger';
import { PayrollStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * HR-6 (أ) (GF-IMP-W3): مرشحات قائمة كشوف الرواتب — كلها اختيارية:
 * الحالة، العامل، ونطاق الفترة (بالتقاطع: كشف يبدأ قبل to وينتهي بعد from).
 */
export class PayrollQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: PayrollStatus,
    example: PayrollStatus.DRAFT,
    description: 'تصفية بحالة الكشف (DRAFT/APPROVED/PAID)',
  })
  @IsOptional()
  @IsEnum(PayrollStatus, {
    message: 'حالة كشف الراتب يجب أن تكون DRAFT أو APPROVED أو PAID',
  })
  status?: PayrollStatus;

  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000001',
    description: 'تصفية بعامل محدد',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId?: string;

  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'من تاريخ (تقاطع الفترة: periodEnd ≥ from)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'إلى تاريخ (تقاطع الفترة: periodStart ≤ to)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;
}
