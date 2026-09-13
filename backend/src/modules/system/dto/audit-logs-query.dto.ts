import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W3 — تصفية سجل التدقيق (يقلد GET /api/audit-logs في Selim:
 * نفس المعاملات مع تكييف أسماء الحقول لـ ActivityLog عندنا:
 * entityType→module، action كما هي، userId، startDate/endDate، ترقيم).
 */
export class AuditLogsQueryDto {
  @ApiPropertyOptional({ example: 'SALES' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  module?: string;

  @ApiPropertyOptional({ example: 'POS_SALE_COMPLETED' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  userId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, description: 'حد أقصى 200' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
