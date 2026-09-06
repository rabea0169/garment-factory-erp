import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShipmentStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

/**
 * SHP-5 (P2 — GF-IMP-W3): مرشحات قائمة الشحنات.
 *
 * CC-6: يرث القالب الموحد (page/limit/from/to/q — الفترة على createdAt
 * والبحث الحر على code/trackingNumber) ويضيف فلتر الحالة النوعي.
 */
export class ShipmentQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    enum: ShipmentStatus,
    example: ShipmentStatus.IN_TRANSIT,
    description: 'تصفية بحالة الشحنة',
  })
  @IsOptional()
  @IsEnum(ShipmentStatus, { message: 'حالة الشحنة غير صالحة' })
  status?: ShipmentStatus;
}
