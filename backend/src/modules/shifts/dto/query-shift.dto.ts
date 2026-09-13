import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات قائمة الورديات (يقلد GET /api/shifts في Selim ERP):
 * فلترة حالة + من فتح الوردية + نطاق زمني على وقت البدء + ترقيم صفحات.
 */
export class QueryShiftDto {
  @ApiPropertyOptional({
    enum: ['OPEN', 'CLOSED'],
    description: 'فلترة الحالة',
  })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'], { message: 'حالة الوردية غير صالحة' })
  status?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-user',
    description: 'فلترة من فتح الوردية',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المستخدم يجب أن يكون UUID صالحًا' })
  openedBy?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'من تاريخ (وقت البدء)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'إلى تاريخ (وقت البدء)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "إلى تاريخ" يجب أن تكون ISO 8601' })
  to?: string;

  @ApiPropertyOptional({ example: 1, description: 'رقم الصفحة (≥ 1)' })
  @IsInt({ message: 'الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'الصفحة تبدأ من 1' })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'حجم الصفحة (1-100)' })
  @IsInt({ message: 'حجم الصفحة يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'حجم الصفحة ≥ 1' })
  @Max(100, { message: 'حجم الصفحة ≤ 100' })
  @IsOptional()
  limit?: number;
}
