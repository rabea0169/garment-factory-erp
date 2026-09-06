import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionStage, WorkOrderStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

/**
 * PRD-7 (P2 — GF-IMP-W3): فلاتر قائمة أوامر التشغيل فوق قالب ListQueryDto
 * المشترك من common/dto (جاهز — CC-6): page/limit/from/to/q موروثة ولا
 * يُعاد تعريفها (عقد القالب)، والفلاتر النوعية هنا: الحالة
 * (WorkOrderStatus) والمرحلة الحالية (ProductionStage). from/to تُطبّقان
 * على createdAt (تُتحقق في الخدمة from ≤ to)، وq يبحث في كود أمر التشغيل
 * (الحقل النصي الوحيد المعرف في المخطط) بcontains غير حساس.
 */
export class WorkOrderQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    enum: WorkOrderStatus,
    example: WorkOrderStatus.IN_PROGRESS,
    description: 'تصفية بحالة أمر التشغيل',
  })
  @IsOptional()
  @IsEnum(WorkOrderStatus, { message: 'حالة أمر التشغيل غير صالحة' })
  status?: WorkOrderStatus;

  @ApiPropertyOptional({
    enum: ProductionStage,
    example: ProductionStage.SEWING,
    description: 'تصفية بالمرحلة الحالية (GF-0013)',
  })
  @IsOptional()
  @IsEnum(ProductionStage, { message: 'مرحلة الإنتاج غير صالحة' })
  currentStage?: ProductionStage;
}
