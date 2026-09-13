import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W1 — DTO سند قبض عامل (يقلد POST /api/worker-receipts في
 * Selim ERP): مبلغ يُقبض من العامل تسويةً لسلفة/مديونية، مع خزينة
 * اختيارية تُخصم من رصيدها داخل نفس معاملة القيد.
 */
export class CreateWorkerReceiptDto {
  @ApiProperty({ example: 'uuid-of-worker', description: 'معرف العامل' })
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId: string;

  @ApiProperty({ example: 250, description: 'المبلغ المقبوض (موجب)' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'المبلغ يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0.01, { message: 'مبلغ السند يجب أن يكون أكبر من صفر' })
  @Max(1_000_000_000, { message: 'المبلغ يتجاوز الحد المسموح' })
  amount: number;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description: 'تاريخ السند (الافتراضي الآن)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة التاريخ يجب أن تكون ISO 8601' })
  date?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-treasury',
    description: 'الخزينة التي استُلم منها المبلغ (اختياري)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;

  @ApiPropertyOptional({
    example: 'تسوية سلفة شهر 8',
    description: 'ملاحظات',
  })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'الملاحظات لا تتجاوز 500 حرف' })
  notes?: string;
}
