import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * SELIM-ERP W1 — DTO إنشاء مجموعة مقاسات (يقلد POST /api/size-groups في
 * Selim ERP): اسم فريد + قائمة مقاسات مرتبة كما أُدخلت ("S M L XL").
 */
export class CreateSizeGroupDto {
  @ApiProperty({ example: 'شبابي', description: 'اسم المجموعة (فريد)' })
  @IsString({ message: 'اسم المجموعة يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم المجموعة مطلوب' })
  @MaxLength(50, { message: 'اسم المجموعة لا يتجاوز 50 حرفًا' })
  name: string;

  @ApiProperty({
    example: ['S', 'M', 'L', 'XL'],
    description: 'المقاسات بالترتيب (واحد على الأقل)',
    type: [String],
  })
  @IsArray({ message: 'المقاسات يجب أن تكون مصفوفة نصوص' })
  @ArrayMinSize(1, { message: 'المجموعة تتضمن مقاسًا واحدًا على الأقل' })
  @IsString({ each: true, message: 'كل مقاس يجب أن يكون نصًا' })
  sizes: string[];
}

/**
 * SELIM-ERP W1 — DTO تعديل مجموعة مقاسات.
 */
export class UpdateSizeGroupDto {
  @ApiPropertyOptional({ example: 'أطفال', description: 'الاسم الجديد' })
  @IsOptional()
  @IsString({ message: 'اسم المجموعة يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم المجموعة لا يمكن أن يكون فارغًا' })
  @MaxLength(50, { message: 'اسم المجموعة لا يتجاوز 50 حرفًا' })
  name?: string;

  @ApiPropertyOptional({
    example: ['2', '4', '6'],
    description: 'المقاسات الجديدة (تستبدل القديمة)',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'المقاسات يجب أن تكون مصفوفة نصوص' })
  @ArrayMinSize(1, { message: 'المجموعة تتضمن مقاسًا واحدًا على الأقل' })
  @IsString({ each: true, message: 'كل مقاس يجب أن يكون نصًا' })
  sizes?: string[];
}
