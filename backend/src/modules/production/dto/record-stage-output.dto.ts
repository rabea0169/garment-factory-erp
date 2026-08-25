import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionStage } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class RecordStageOutputDto {
  @ApiProperty({ enum: ProductionStage, example: ProductionStage.CUTTING })
  @IsEnum(ProductionStage, { message: 'مرحلة الإنتاج غير صالحة' })
  stage: ProductionStage;

  @ApiProperty({ example: 10, description: 'كمية الإدخال للمرحلة' })
  @IsInt({ message: 'كمية الإدخال يجب أن تكون عددًا صحيحًا' })
  @IsPositive({ message: 'كمية الإدخال يجب أن تكون موجبة' })
  inputQty: number;

  @ApiProperty({ example: 8, description: 'الكمية المقبولة' })
  @IsInt({ message: 'الكمية المقبولة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية المقبولة لا يمكن أن تكون سالبة' })
  acceptedQty: number;

  @ApiProperty({ example: 1, description: 'الكمية المرفوضة' })
  @IsInt({ message: 'الكمية المرفوضة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية المرفوضة لا يمكن أن تكون سالبة' })
  rejectedQty: number;

  @ApiProperty({ example: 1, description: 'كمية الهدر' })
  @IsInt({ message: 'كمية الهدر يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'كمية الهدر لا يمكن أن تكون سالبة' })
  wasteQty: number;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'مخزن المنتج التام، ويستخدم عند إكمال PACKING',
  })
  @IsOptional()
  @IsUUID(undefined, {
    message: 'معرف مخزن المنتج التام يجب أن يكون UUID صالحًا',
  })
  finishedGoodsWarehouseId?: string;

  @ApiPropertyOptional({
    example: 'هدر قص ضمن الحدود المعتمدة',
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @IsNotEmpty({ message: 'الملاحظات لا يمكن أن تكون نصًا فارغًا' })
  notes?: string;
}
