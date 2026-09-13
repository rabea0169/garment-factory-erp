import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * SELIM-ERP W1 — مكون عبوة (يقلد PackComponent في Selim ERP): توليفة
 * بكمية محددة داخل العبوة الواحدة (قطع صحيحة — العبوات قطع كاملة).
 */
export class PackComponentInputDto {
  @ApiProperty({
    example: 'uuid-of-variant',
    description: 'معرف التوليفة SKU',
  })
  @IsUUID(undefined, { message: 'معرف التوليفة يجب أن يكون UUID صالحًا' })
  productVariantId: string;

  @ApiProperty({
    example: 12,
    description: 'الكمية داخل العبوة الواحدة (عدد صحيح ≥ 1)',
  })
  @IsInt({ message: 'كمية المكون يجب أن تكون عددًا صحيحًا' })
  @Min(1, { message: 'كمية المكون يجب أن تكون 1 على الأقل' })
  quantity: number;
}

/**
 * SELIM-ERP W1 — إنشاء عبوة (يقلد POST /api/packing في Selim ERP).
 *
 * حقل code اختياري للتوافق مع عملاء Selim — يُتجاهَل: الترقيم عنصر
 * نظامي (PACK-0001) عبر SequenceService ولا يقبل من العميل أبدًا.
 */
export class CreatePackDto {
  @ApiPropertyOptional({
    example: 'SR12',
    description: 'كود العبوة من العميل — يُتجاهَل (الترقيم نظامي PACK-0001)',
  })
  @IsOptional()
  @IsString({ message: 'كود العبوة يجب أن يكون نصًا' })
  code?: string;

  @ApiProperty({ example: 'سرية 12 قطعة', description: 'اسم العبوة' })
  @IsString({ message: 'اسم العبوة يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم العبوة مطلوب' })
  @MaxLength(100, { message: 'اسم العبوة لا يتجاوز 100 حرف' })
  name: string;

  @ApiPropertyOptional({ example: 'تعبئة شنطة سفر', description: 'ملاحظات' })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'الملاحظات لا تتجاوز 500 حرف' })
  notes?: string;

  @ApiProperty({
    type: [PackComponentInputDto],
    description: 'مكونات العبوة (توليفة + كمية) — بند واحد على الأقل',
  })
  @IsArray({ message: 'المكونات يجب أن تكون مصفوفة' })
  @ArrayNotEmpty({ message: 'العبوة يجب أن تحتوي على مكون واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => PackComponentInputDto)
  components: PackComponentInputDto[];
}
