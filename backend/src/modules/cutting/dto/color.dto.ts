import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * SELIM-ERP W1 — DTO إنشاء لون (يقلد POST /api/colors في Selim ERP):
 * اسم فريد + كود hex بصيغة #RRGGBB.
 */
export class CreateColorDto {
  @ApiProperty({ example: 'كحلي', description: 'اسم اللون (فريد)' })
  @IsString({ message: 'اسم اللون يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم اللون مطلوب' })
  @MaxLength(50, { message: 'اسم اللون لا يتجاوز 50 حرفًا' })
  name: string;

  @ApiProperty({
    example: '#1F3A93',
    description: 'كود اللون hex بصيغة #RRGGBB',
  })
  @IsString({ message: 'كود اللون يجب أن يكون نصًا' })
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'كود اللون يجب أن يكون بصيغة #RRGGBB مثل #1F3A93',
  })
  hex: string;
}

/**
 * SELIM-ERP W1 — DTO تعديل لون: الحقول المرسلة فقط تُحدَّث.
 */
export class UpdateColorDto {
  @ApiPropertyOptional({ example: 'كحلي غامق', description: 'الاسم الجديد' })
  @IsOptional()
  @IsString({ message: 'اسم اللون يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم اللون لا يمكن أن يكون فارغًا' })
  @MaxLength(50, { message: 'اسم اللون لا يتجاوز 50 حرفًا' })
  name?: string;

  @ApiPropertyOptional({ example: '#0B2161', description: 'الكود الجديد' })
  @IsOptional()
  @IsString({ message: 'كود اللون يجب أن يكون نصًا' })
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'كود اللون يجب أن يكون بصيغة #RRGGBB مثل #1F3A93',
  })
  hex?: string;
}
