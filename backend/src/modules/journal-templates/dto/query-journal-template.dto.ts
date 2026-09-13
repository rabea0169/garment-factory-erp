import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * SELIM-ERP W1 — مرشحات قائمة قوالب القيود (يقلد GET /api/journal-templates):
 * فلترة بالمتكرر (isRecurring) + بحث نصي في الاسم + ترقيم.
 */
export class QueryJournalTemplateDto extends PaginationDto {
  @ApiPropertyOptional({
    example: true,
    description: 'القوالب المتكررة فقط (false = غير المتكررة فقط)',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'isRecurring يجب أن يكون قيمة منطقية' })
  isRecurring?: boolean;

  @ApiPropertyOptional({
    example: 'إيجار',
    description: 'بحث جزئي في اسم القالب',
  })
  @IsOptional()
  @IsString({ message: 'نص البحث يجب أن يكون نصًا' })
  @MaxLength(100, { message: 'نص البحث يتجاوز 100 حرف' })
  search?: string;
}
