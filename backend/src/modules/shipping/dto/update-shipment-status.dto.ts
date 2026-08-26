import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShipmentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateShipmentStatusDto {
  @ApiProperty({ enum: ShipmentStatus })
  @IsEnum(ShipmentStatus, { message: 'حالة الشحنة غير صالحة' })
  status: ShipmentStatus;

  @ApiPropertyOptional({ example: 'POD-2026-0001' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  proofOfDelivery?: string;
}
