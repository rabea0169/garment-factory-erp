import { ApiProperty } from '@nestjs/swagger';
import { StockMovementType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * GF-0007: مرشحات قراءة سجل حركات المخزون — كلها اختيارية.
 * التواريخ ISO 8601 (مثل 2026-08-25T00:00:00Z).
 */
export class LedgerQueryDto {
  @ApiProperty({
    example: 'uuid-of-raw-material',
    description: 'تصفية بخامة محددة',
    required: false,
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId?: string;

  @ApiProperty({
    example: 'uuid-of-warehouse',
    description: 'تصفية بمخزن محدد',
    required: false,
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId?: string;

  @ApiProperty({
    enum: StockMovementType,
    example: StockMovementType.RECEIVE,
    description: 'تصفية بنوع الحركة',
    required: false,
  })
  @IsOptional()
  @IsEnum(StockMovementType, {
    message:
      'نوع الحركة يجب أن يكون RECEIVE أو ISSUE أو ADJUSTMENT أو WASTE أو RETURN',
  })
  type?: StockMovementType;

  @ApiProperty({
    example: '2026-08-01T00:00:00Z',
    description: 'من تاريخ (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiProperty({
    example: '2026-08-31T23:59:59Z',
    description: 'إلى تاريخ (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;

  // ملاحظة: لا حاجة للـ Transform — التواريخ تُحوَّل داخل الخدمة عبر new Date()
  // والقيم الفاسدة يرفضها IsDateString على الباب.
}
