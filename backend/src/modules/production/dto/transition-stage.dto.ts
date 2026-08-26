import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionStage } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class TransitionStageDto {
  @ApiProperty({ enum: ProductionStage, example: ProductionStage.SEWING })
  @IsEnum(ProductionStage, { message: 'مرحلة الإنتاج غير صالحة' })
  toStage: ProductionStage;

  @ApiPropertyOptional({
    example: 'تم اعتماد مخرجات القص للانتقال إلى الخياطة',
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: 'سبب الانتقال يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'سبب الانتقال لا يمكن أن يكون فارغًا' })
  @MaxLength(500, { message: 'سبب الانتقال يتجاوز 500 حرف' })
  reason?: string;
}
