import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * ACC-8 (P2 — GF-IMP-W3): مرشحات قائمة قيود اليومية — كلها اختيارية:
 * نطاق تاريخ القيد (from/to)، حالة العكس (isReversed)، ومرجع يحتوي نصًا
 * (بحث جزئي contains). البنود تُضمَّن في الاستجابة لكل قيد.
 */
export class JournalEntryQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00Z',
    description: 'من تاريخ القيد (ISO 8601)',
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

  @ApiPropertyOptional({
    example: false,
    description: 'تصفية بحالة العكس: false = القيود غير المعكوسة فقط',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isReversed يجب أن يكون قيمة منطقية' })
  isReversed?: boolean;

  @ApiPropertyOptional({
    example: 'SO-2026',
    description: 'بحث جزئي في مرجع القيد (يحتوي النص)',
  })
  @IsOptional()
  @IsString({ message: 'نص المرجع يجب أن يكون نصًا' })
  @MaxLength(100, { message: 'نص المرجع يتجاوز 100 حرف' })
  reference?: string;
}
