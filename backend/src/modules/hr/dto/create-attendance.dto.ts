import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateAttendanceDto {
  @ApiProperty({ example: 'uuid-of-worker' })
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId: string;

  @ApiProperty({ example: '2026-08-26', description: 'تاريخ الحضور بصيغة ISO' })
  @IsDateString({}, { message: 'تاريخ الحضور يجب أن يكون تاريخ ISO صالحًا' })
  date: string;

  @ApiProperty({ example: true })
  @IsBoolean({ message: 'حالة الحضور يجب أن تكون true أو false' })
  isPresent: boolean;

  @ApiPropertyOptional({ example: 'حضور يدوي من المشرف' })
  @IsOptional()
  @IsString({ message: 'ملاحظات الحضور يجب أن تكون نصًا' })
  @IsNotEmpty({ message: 'ملاحظات الحضور لا يمكن أن تكون فارغة' })
  @MaxLength(500, { message: 'ملاحظات الحضور تتجاوز 500 حرف' })
  notes?: string;
}
