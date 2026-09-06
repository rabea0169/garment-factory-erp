import { ApiPropertyOptional } from '@nestjs/swagger';
import { SalesOrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * SAL-5 (P2 — GF-IMP-W3): مرشحات قائمة أوامر البيع — كلها اختيارية:
 * الحالة، العميل، نطاق تاريخ الإنشاء، وبحث نصي q في كود الأمر.
 * مع الفلاتر يكفي الفهرس المركب (status, createdAt) و(customerId).
 */
export class SalesOrderQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: SalesOrderStatus,
    example: SalesOrderStatus.CONFIRMED,
    description: 'تصفية بحالة الأمر (DRAFT/CONFIRMED/SHIPPED/CANCELLED)',
  })
  @IsOptional()
  @IsEnum(SalesOrderStatus, {
    message:
      'حالة أمر البيع يجب أن تكون DRAFT أو CONFIRMED أو SHIPPED أو CANCELLED',
  })
  status?: SalesOrderStatus;

  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000009',
    description: 'تصفية بعميل محدد',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العميل يجب أن يكون UUID صالحًا' })
  customerId?: string;

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00Z',
    description: 'من تاريخ إنشاء الأمر (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59Z',
    description: 'إلى تاريخ إنشاء الأمر (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;

  @ApiPropertyOptional({
    example: 'SO-2026',
    description: 'بحث جزئي في كود الأمر (يحتوي النص، غير حساس لحالة الأحرف)',
  })
  @IsOptional()
  @Type(() => String)
  @IsString({ message: 'نص البحث يجب أن يكون نصًا' })
  @MaxLength(60, { message: 'نص البحث يتجاوز 60 حرفًا' })
  q?: string;
}
