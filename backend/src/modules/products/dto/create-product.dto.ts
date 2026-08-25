import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'PRD-T01', description: 'كود المنتج الفريد' })
  @IsString()
  @IsNotEmpty({ message: 'كود المنتج مطلوب' })
  code: string;

  @ApiProperty({ example: 'تيشيرت صيفي بولو', description: 'اسم المنتج' })
  @IsString()
  @IsNotEmpty({ message: 'اسم المنتج مطلوب' })
  name: string;

  @ApiProperty({ example: 'تيشيرت', description: 'التصنيف' })
  @IsString()
  @IsNotEmpty({ message: 'التصنيف مطلوب' })
  category: string;

  @ApiProperty({
    example: 250,
    description: 'سعر التجزئة (يجب أن يكون موجبًا)',
  })
  @IsPositive({ message: 'سعر التجزئة يجب أن يكون رقمًا موجبًا' })
  retailPrice: number;

  @ApiProperty({ example: 180, description: 'سعر الجملة (يجب أن يكون موجبًا)' })
  @IsPositive({ message: 'سعر الجملة يجب أن يكون رقمًا موجبًا' })
  wholesalePrice: number;

  @ApiPropertyOptional({
    example: 'uuid-of-season',
    description: 'معرف الموسم (اختياري)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الموسم يجب أن يكون UUID صالحًا' })
  seasonId?: string;
}
