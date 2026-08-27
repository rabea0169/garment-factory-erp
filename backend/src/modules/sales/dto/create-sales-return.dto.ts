import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSalesReturnItemDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000003' })
  @IsUUID()
  salesOrderItemId: string;

  @ApiProperty({ example: 2, description: 'الكمية المرتجعة' })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateSalesReturnDto {
  @ApiProperty({ type: [CreateSalesReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesReturnItemDto)
  items: CreateSalesReturnItemDto[];

  @ApiPropertyOptional({ example: 'عيب تصنيع', description: 'سبب المرتجع' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}
