import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * SELIM-ERP W3 — DTOs مراكز التكلفة (نقل من cost-centerSchema في
 * lib/api-schemas عند Selim ERP): كود فريد + اسم + حالة تنشيط.
 */
export class CreateCostCenterDto {
  @ApiProperty({ example: 'CC-01' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 30)
  code!: string;

  @ApiProperty({ example: 'خط الإنتاج أ' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCostCenterDto {
  @ApiPropertyOptional({ example: 'خط الإنتاج أ — محدث' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ description: 'تعطيل/تنشيط المركز' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
