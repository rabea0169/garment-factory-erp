import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * GF-0007: صرف خامات من مخزن (للإنتاج/البيع) — كمية سالبة في الـ ledger،
 * يرفضها الخادم إذا أظهرت الرصيد لقيمة سالبة (ADR-0007).
 */
export class IssueStockDto {
  @ApiProperty({ example: 'uuid-of-raw-material', description: 'معرف الخامة' })
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiProperty({ example: 'uuid-of-warehouse', description: 'معرف المخزن' })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiProperty({ example: 20, description: 'الكمية المصروفة (موجبة)' })
  @IsPositive({ message: 'الكمية يجب أن تكون رقمًا موجبًا' })
  quantity: number;

  @ApiProperty({
    example: 'WO-2026-014',
    description: 'مرجع المستند (أمر تشغيل/طلب صرف) — اختياري',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'المرجع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المرجع لا يمكن أن يكون نصًا فارغًا' })
  reference?: string;

  @ApiProperty({
    example: 'صرف قماش لأمر تشغيل التيشيرت',
    description: 'ملاحظات — اختياري',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  notes?: string;
}
