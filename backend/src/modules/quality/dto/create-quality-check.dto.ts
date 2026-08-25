import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RejectionReason, WorkOrderStatus } from '@prisma/client';
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
    enum: WorkOrderStatus,
    example: WorkOrderStatus.SEWING,
    description: 'المرحلة التي تم الفحص عندها',
  })
  @IsEnum(WorkOrderStatus, {
    message: 'المرحلة يجب أن تكون إحدى قيم WorkOrderStatus',
  })
  stage: WorkOrderStatus;

  @ApiProperty({ example: 100, description: 'الكمية المفحوصة (عدد صحيح ≥ 0)' })
  @IsInt({ message: 'الكمية المفحوصة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية المفحوصة لا يمكن أن تكون سالبة' })
  checkedQty: number;

  @ApiProperty({ example: 95, description: 'الكمية الناجحة (عدد صحيح ≥ 0)' })
  @IsInt({ message: 'الكمية الناجحة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية الناجحة لا يمكن أن تكون سالبة' })
  passedQty: number;

  @ApiProperty({ example: 5, description: 'الكمية المرفوضة (عدد صحيح ≥ 0)' })
  @IsInt({ message: 'الكمية المرفوضة يجب أن تكون عددًا صحيحًا' })
  @Min(0, { message: 'الكمية المرفوضة لا يمكن أن تكون سالبة' })
  rejectedQty: number;

  @ApiPropertyOptional({
    enum: RejectionReason,
    example: RejectionReason.SEWING_DEFECT,
    description: 'سبب الرفض (اختياري)',
  })
  @IsOptional()
  @IsEnum(RejectionReason, {
    message: 'سبب الرفض يجب أن يكون إحدى قيم RejectionReason',
  })
  rejectionReason?: RejectionReason;

  @ApiPropertyOptional({
    example: 'عيوب خياطة في الأكمام',
    description: 'ملاحظات (اختياري)',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  // ملاحظة: قاعدة checked = passed + rejected (قاموس المجال رقم 3) تُفرض في GF-0014
  // كقاعدة أعمال مع اختبار سلوكي — هنا نتحقق من صحة المدخلات فقط.
}
