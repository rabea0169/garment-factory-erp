import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PaymentType } from '@prisma/client';

export class PurchaseOrderItemDto {
  @ApiProperty({
    example: 'uuid-of-raw-material',
    description: 'معرف المادة الخام',
  })
  @IsUUID(undefined, { message: 'معرف المادة الخام يجب أن يكون UUID صالحًا' })
  rawMaterialId: string;

  // PUR-1: موجبة إلزاميًا (كانت IsNumber عامًا يقبل السالب)، وبحد 4 منازل
  // عشرية مطابق لعمود Decimal(10,4) في القاعدة.
  @ApiProperty({
    example: 12.5,
    description: 'الكمية — رقم موجب بحد أقصى 4 منازل عشرية',
  })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'الكمية يجب أن تكون رقمًا بحد أقصى 4 منازل عشرية' },
  )
  @IsPositive({ message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity: number;

  // PUR-1: موجبة إلزاميًا وبحد منزلتين مطابق لعمود Decimal(10,2).
  @ApiProperty({
    example: 25.5,
    description: 'تكلفة الوحدة — رقم موجب بمنزلتين عشريتين كحد أقصى',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'تكلفة الوحدة يجب أن تكون رقمًا بمنزلتين عشريتين كحد أقصى' },
  )
  @IsPositive({ message: 'تكلفة الوحدة يجب أن تكون أكبر من صفر' })
  unitCost: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({
    example: 'uuid-of-supplier',
    description: 'معرف المورد',
  })
  @IsUUID(undefined, { message: 'معرف المورد يجب أن يكون UUID صالحًا' })
  supplierId: string;

  @ApiProperty({
    enum: PaymentType,
    example: PaymentType.CASH,
    description: 'نوع الدفع',
  })
  @IsEnum(PaymentType, {
    message: 'نوع الدفع يجب أن يكون CASH أو CREDIT أو PARTIAL',
  })
  paymentType: PaymentType;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'تاريخ الاستحقاق (اختياري)',
  })
  @IsDateString(
    {},
    { message: 'تاريخ الاستحقاق يجب أن يكون تاريخًا صالحًا بصيغة ISO' },
  )
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({
    example: 'ملاحظات أمر الشراء',
    description: 'ملاحظات (اختياري)',
  })
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @IsOptional()
  @MaxLength(500, { message: 'الملاحظات لا تتجاوز 500 حرف' })
  notes?: string;

  // PUR-1: البنود غير فارغة إلزاميًا (كانت IsArray وحدها تقبل []) وبحجم
  // معقول أقصاه 200 بند.
  @ApiProperty({
    type: [PurchaseOrderItemDto],
    description: 'بنود أمر الشراء (بند واحد على الأقل، 200 كحد أقصى)',
  })
  @IsArray({ message: 'البنود يجب أن تكون مصفوفة' })
  @ArrayMinSize(1, {
    message: 'أمر الشراء يجب أن يحتوي على بند واحد على الأقل',
  })
  @ArrayMaxSize(200, {
    message: 'أمر الشراء لا يجوز أن يتجاوز 200 بند',
  })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
