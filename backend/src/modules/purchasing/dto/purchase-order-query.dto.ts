import { ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

/**
 * PUR-6 (أ) (P2 — GF-IMP-W3): مرشحات قائمة أوامر الشراء.
 *
 * CC-6: يرث القالب الموحد (page/limit/from/to/q — الفترة على createdAt
 * والبحث الحر على code) ويضيف فلترين نوعيين: status وsupplierId.
 * كانت القائمة ترجع كل الأوامر بلا أي فلترة وبـ include بنود كامل.
 */
export class PurchaseOrderQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    enum: PurchaseOrderStatus,
    example: PurchaseOrderStatus.APPROVED,
    description: 'تصفية بحالة أمر الشراء',
  })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus, { message: 'حالة أمر الشراء غير صالحة' })
  status?: PurchaseOrderStatus;

  @ApiPropertyOptional({
    example: 'uuid-of-supplier',
    description: 'تصفية بمورد محدد',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف المورد يجب أن يكون UUID صالحًا' })
  supplierId?: string;
}
