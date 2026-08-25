import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateProductVariantDto {
  @ApiProperty({ example: 'L', description: 'المقاس' })
  @IsString()
  @IsNotEmpty({ message: 'المقاس مطلوب' })
  size: string;

  @ApiProperty({ example: 'أزرق', description: 'اللون' })
  @IsString()
  @IsNotEmpty({ message: 'اللون مطلوب' })
  color: string;
}
