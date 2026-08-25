import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionWasteReason } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ConsumeMaterialDto {
  @ApiProperty({ example: 'uuid-of-stage-run' })
  @IsUUID(undefined, { message: 'معرف تشغيل المرحلة يجب أن يكون UUID صالحًا' })
  stageRunId: string;

  @ApiProperty({ example: 'uuid-of-raw-material' })
  @IsUUID(undefined, { message: 'معرف الخامة يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiProperty({ example: 'uuid-of-raw-warehouse' })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiProperty({ example: 3.5, description: 'الكمية المخططة' })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية المخططة يجب أن تكون رقمًا صالحًا' },
  )
  @IsPositive({ message: 'الكمية المخططة يجب أن تكون موجبة' })
  plannedQuantity: number;

  @ApiProperty({ example: 4, description: 'الكمية الفعلية المصروفة' })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية الفعلية يجب أن تكون رقمًا صالحًا' },
  )
  @IsPositive({ message: 'الكمية الفعلية يجب أن تكون موجبة' })
  actualQuantity: number;

  @ApiProperty({ example: 0.5, description: 'كمية الهدر ضمن الكمية الفعلية' })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'كمية الهدر يجب أن تكون رقمًا صالحًا' },
  )
  @Min(0, { message: 'كمية الهدر لا يمكن أن تكون سالبة' })
  wasteQuantity: number;

  @ApiProperty({ example: 'METER' })
  @IsString({ message: 'الوحدة يجب أن تكون نصًا' })
  @IsNotEmpty({ message: 'الوحدة مطلوبة' })
  @MaxLength(32, { message: 'الوحدة تتجاوز 32 حرفًا' })
  unit: string;

  @ApiPropertyOptional({
    enum: ProductionWasteReason,
    example: ProductionWasteReason.CUTTING_LOSS,
  })
  @IsOptional()
  @IsEnum(ProductionWasteReason, { message: 'سبب الهدر غير صالح' })
  wasteReason?: ProductionWasteReason;

  @ApiPropertyOptional({ example: 'WO-2026-014' })
  @IsOptional()
  @IsString({ message: 'المرجع يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المرجع لا يمكن أن يكون نصًا فارغًا' })
  @MaxLength(120, { message: 'المرجع يتجاوز 120 حرفًا' })
  reference?: string;

  @ApiPropertyOptional({ example: 'صرف القماش لمرحلة القص' })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'الملاحظات تتجاوز 500 حرف' })
  notes?: string;
}
