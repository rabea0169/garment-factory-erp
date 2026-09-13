import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — مرشحات قائمة سندات قبض العمال (يقلد GET /api/worker-receipts
 * في Selim ERP): فلترة العامل + نطاق زمني + ترقيم، مع مجاميع لكل عامل
 * داخل نفس المرشحات (تقرير متابعة تسويات العمال).
 */
export class QueryWorkerReceiptDto {
  @ApiPropertyOptional({
    example: 'uuid-of-worker',
    description: 'فلترة العامل',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'من تاريخ' })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "من تاريخ" يجب أن تكون ISO 8601' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'إلى تاريخ' })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة "إلى تاريخ" يجب أن تكون ISO 8601' })
  to?: string;

  @ApiPropertyOptional({ example: 1, description: 'رقم الصفحة (≥ 1)' })
  @IsOptional()
  @IsInt({ message: 'الصفحة يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'الصفحة تبدأ من 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'حجم الصفحة (1-100)' })
  @IsOptional()
  @IsInt({ message: 'حجم الصفحة يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'حجم الصفحة ≥ 1' })
  @Max(100, { message: 'حجم الصفحة ≤ 100' })
  limit?: number;
}
