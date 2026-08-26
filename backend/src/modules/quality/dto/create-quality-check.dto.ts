import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ProductionStage,
  QualityWasteReason,
  RejectionReason,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateQualityCheckDto {
  @ApiProperty({
    example: 'uuid-of-work-order',
    description: 'معرف أمر التشغيل',
  })
  @IsUUID(undefined, { message: 'معرف أمر التشغيل يجب أن يكون UUID صالحًا' })
  workOrderId: string;

  @ApiProperty({
    example: 'uuid-of-stage-run',
    description: 'معرف تنفيذ المرحلة الفعلي',
  })
  @IsUUID(undefined, { message: 'معرف تنفيذ المرحلة يجب أن يكون UUID صالحًا' })
  stageRunId: string;

  @ApiProperty({
    enum: ProductionStage,
    example: ProductionStage.SEWING,
    description: 'المرحلة الفعلية التي تم الفحص عندها',
  })
  @IsEnum(ProductionStage, { message: 'المرحلة غير صالحة' })
  stage: ProductionStage;

  @ApiProperty({ example: 100, description: 'الكمية المفحوصة' })
  @IsInt({ message: 'الكمية المفحوصة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية المفحوصة لا يمكن أن تكون سالبة' })
  checkedQty: number;

  @ApiProperty({ example: 90, description: 'الكمية الناجحة' })
  @IsInt({ message: 'الكمية الناجحة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية الناجحة لا يمكن أن تكون سالبة' })
  passedQty: number;

  @ApiProperty({ example: 5, description: 'الكمية المرفوضة' })
  @IsInt({ message: 'الكمية المرفوضة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية المرفوضة لا يمكن أن تكون سالبة' })
  rejectedQty: number;

  @ApiProperty({ example: 5, description: 'كمية الهالك المصنف' })
  @IsInt({ message: 'كمية الهالك يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'كمية الهالك لا يمكن أن تكون سالبة' })
  wasteQty: number;

  @ApiPropertyOptional({
    enum: RejectionReason,
    example: RejectionReason.SEWING_DEFECT,
  })
  @IsOptional()
  @IsEnum(RejectionReason, { message: 'سبب الرفض غير صالح' })
  rejectionReason?: RejectionReason;

  @ApiPropertyOptional({
    enum: QualityWasteReason,
    example: QualityWasteReason.DEFECT_RELATED,
  })
  @IsOptional()
  @IsEnum(QualityWasteReason, { message: 'سبب الهالك غير صالح' })
  wasteReason?: QualityWasteReason;

  @ApiPropertyOptional({ example: 'عيوب خياطة في الأكمام' })
  @IsOptional()
  @IsString()
  notes?: string;
}
