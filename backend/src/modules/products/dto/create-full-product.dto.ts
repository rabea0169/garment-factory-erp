import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateBomLineDto } from './create-bom-line.dto';
import { CreateProductDto } from './create-product.dto';
import { CreateProductVariantDto } from './create-product-variant.dto';

export class CreateFullProductDto extends CreateProductDto {
  @ApiPropertyOptional({
    type: [CreateProductVariantDto],
    description: 'المتغيرات الأولية للمنتج، مثل المقاس واللون',
  })
  @IsOptional()
  @IsArray({ message: 'قائمة المتغيرات يجب أن تكون مصفوفة' })
  @ArrayMaxSize(100, { message: 'عدد المتغيرات يتجاوز الحد المسموح' })
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants: CreateProductVariantDto[] = [];

  @ApiPropertyOptional({
    type: [CreateBomLineDto],
    description: 'بنود شجرة التصنيع الأولية للمنتج',
  })
  @IsOptional()
  @IsArray({ message: 'قائمة BOM يجب أن تكون مصفوفة' })
  @ArrayMaxSize(200, { message: 'عدد بنود BOM يتجاوز الحد المسموح' })
  @ValidateNested({ each: true })
  @Type(() => CreateBomLineDto)
  bomItems: CreateBomLineDto[] = [];
}
