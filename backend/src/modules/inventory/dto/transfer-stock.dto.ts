import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class TransferStockDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000010' })
  @IsUUID(undefined, { message: 'معرف المادة الخام يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  @ApiProperty({ example: '00000000-0000-0000-0000-000000000011' })
  @IsUUID(undefined, { message: 'مخزن المصدر يجب أن يكون UUID صالحًا' })
  fromWarehouseId: string;

  @ApiProperty({ example: '00000000-0000-0000-0000-000000000012' })
  @IsUUID(undefined, { message: 'مخزن الوجهة يجب أن يكون UUID صالحًا' })
  toWarehouseId: string;

  @ApiProperty({ example: 12.5 })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'كمية التحويل يجب أن تكون رقمًا صالحًا حتى 4 منازل' },
  )
  @IsPositive({ message: 'كمية التحويل يجب أن تكون موجبة' })
  quantity: number;

  @ApiPropertyOptional({ example: 'TRF-2026-0001' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ example: 'نقل إلى مخزن التشغيل' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
