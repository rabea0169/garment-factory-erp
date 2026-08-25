import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class RecordProductionDto {
  @ApiProperty({ example: 'uuid-of-worker', description: 'معرف العامل' })
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId: string;

  @ApiPropertyOptional({
    example: 'uuid-of-work-order',
    description: 'معرف أمر التشغيل (اختياري)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف أمر التشغيل يجب أن يكون UUID صالحًا' })
  workOrderId?: string;

  @ApiProperty({
    example: '2026-08-25T00:00:00.000Z',
    description: 'تاريخ الإنتاج (ISO 8601)',
  })
  @Transform(({ value }: { value: unknown }) => {
    // تحويل سلاسل ISO إلى Date؛ القيم غير الصالحة تُترك كما هي ليرفضها IsDate بـ 400
    if (value instanceof Date) return value;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? value : parsed;
  })
  @IsDate({ message: 'التاريخ يجب أن يكون تاريخًا صالحًا (ISO 8601)' })
  date: Date;

  @ApiProperty({
    example: 100,
    description: 'عدد القطع المنتجة (عدد صحيح موجب)',
  })
  @IsInt({ message: 'عدد القطع يجب أن يكون عددًا صحيحًا' })
  @IsPositive({ message: 'عدد القطع يجب أن يكون عددًا موجبًا' })
  piecesCount: number;
}
