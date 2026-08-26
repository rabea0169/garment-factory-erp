import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePayrollDto {
  @ApiProperty({ example: 'uuid-of-worker', description: 'معرف العامل' })
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId: string;

  @ApiProperty({ example: '2026-08-01', description: 'بداية فترة الراتب' })
  @IsDateString({}, { message: 'بداية الفترة يجب أن تكون تاريخ ISO صالحًا' })
  periodStart: string;

  @ApiProperty({ example: '2026-08-31', description: 'نهاية فترة الراتب' })
  @IsDateString({}, { message: 'نهاية الفترة يجب أن تكون تاريخ ISO صالحًا' })
  periodEnd: string;

  @ApiPropertyOptional({ example: 'كشف رواتب أغسطس' })
  @IsOptional()
  @IsString({ message: 'ملاحظات الراتب يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'ملاحظات الراتب تتجاوز 500 حرف' })
  notes?: string;
}
