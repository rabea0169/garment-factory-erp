import { ApiProperty } from '@nestjs/swagger';
import { WorkOrderStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateWorkOrderStatusDto {
  @ApiProperty({
    enum: WorkOrderStatus,
    example: WorkOrderStatus.SEWING,
    description: 'الحالة/المرحلة الجديدة لأمر التشغيل',
  })
  @IsEnum(WorkOrderStatus, {
    message: 'الحالة يجب أن تكون إحدى قيم WorkOrderStatus الصحيحة',
  })
  @IsNotEmpty({ message: 'الحالة مطلوبة' })
  status: WorkOrderStatus;
}
