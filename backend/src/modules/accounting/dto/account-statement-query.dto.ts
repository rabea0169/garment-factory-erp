import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * ACC-8 (P2 — GF-IMP-W3): مرشحات كشف الحساب — نطاق تاريخ القيد
 * (from/to) اختياريان. الرصيد الافتتاحي يُحسب من الحركات السابقة على
 * from عند توفيره، والرصيد الجاري يتراكم على مجموعة البنود المرشحة.
 * معرف الحساب يأتي في المسار (Param) لا في الاستعلام.
 */
export class AccountStatementQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00Z',
    description: 'من تاريخ القيد (ISO 8601) — الرصيد الافتتاحي قبله',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59Z',
    description: 'إلى تاريخ القيد (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;
}
