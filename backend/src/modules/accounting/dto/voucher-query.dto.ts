import { ApiPropertyOptional } from '@nestjs/swagger';
import { VoucherType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * ACC-6 (P2 — GF-IMP-W3): مرشحات قائمة السندات — كلها اختيارية:
 * النوع (صرف/قبض)، الخزينة، الطرف المقابل، ونطاق تاريخ السند.
 * التواريخ ISO 8601 وتُحوَّل داخل الخدمة عبر new Date().
 * الفهارس القائمة (type, date) و(counterpartyId) تكفي الاستعلام المرشّح.
 */
export class VoucherQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: VoucherType,
    example: VoucherType.PAYMENT,
    description: 'تصفية بنوع السند (صرف/قبض)',
  })
  @IsOptional()
  @IsEnum(VoucherType, { message: 'نوع السند يجب أن يكون PAYMENT أو RECEIPT' })
  type?: VoucherType;

  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000001',
    description: 'تصفية بخزينة محددة',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;

  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000099',
    description: 'تصفية بطرف مقابل محدد (عميل/مورد/عامل)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الطرف المقابل يجب أن يكون UUID صالحًا' })
  counterpartyId?: string;

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00Z',
    description: 'من تاريخ السند (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59Z',
    description: 'إلى تاريخ السند (ISO 8601)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;
}
