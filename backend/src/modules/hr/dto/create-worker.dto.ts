import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkerSpecialty } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateWorkerDto {
  @ApiProperty({ example: 'أحمد محمود', description: 'اسم العامل' })
  @IsString()
  @IsNotEmpty({ message: 'اسم العامل مطلوب' })
  name: string;

  @ApiPropertyOptional({ example: '01000000000', description: 'رقم الهاتف' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: '29801011234567',
    description: 'الرقم القومي',
  })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiProperty({ enum: WorkerSpecialty, example: WorkerSpecialty.SEWING })
  @IsEnum(WorkerSpecialty)
  specialty: WorkerSpecialty;

  @ApiPropertyOptional({ example: 5.5, description: 'أجر القطعة' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pieceRate?: number;

  @ApiPropertyOptional({ example: '2026-08-27', description: 'تاريخ التعيين' })
  @IsOptional()
  @IsDateString()
  hireDate?: string;
}
