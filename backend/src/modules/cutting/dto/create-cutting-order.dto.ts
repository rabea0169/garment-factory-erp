import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * SELIM-ERP W1 — بند أمر قص (يقلد CuttingLine في Selim ERP): رقصة (lay)
 * واحدة تُقص إلى مقاس محدد بلون اختياري. الكمية = layCount × piecesPerLay
 * وتُحسب على الخادم — العميل لا يرسل الكميات.
 */
export class CuttingLineInputDto {
  @ApiPropertyOptional({
    example: 'uuid-of-color',
    description: 'معرف اللون المسجل (اختياري — يُستخدم لربط التوليفة)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف اللون يجب أن يكون UUID صالحًا' })
  colorId?: string;

  @ApiPropertyOptional({
    example: 'كحلي',
    description: 'اسم اللون نصًا (لقطة — يُستخدم إن غاب colorId)',
  })
  @IsOptional()
  @IsString({ message: 'اسم اللون يجب أن يكون نصًا' })
  @MaxLength(50, { message: 'اسم اللون لا يتجاوز 50 حرفًا' })
  color?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-size-group',
    description: 'معرف مجموعة المقاسات (اختياري — مرجعية فقط)',
  })
  @IsOptional()
  @IsUUID(undefined, {
    message: 'معرف مجموعة المقاسات يجب أن يكون UUID صالحًا',
  })
  sizeGroupId?: string;

  @ApiProperty({ example: 'L', description: 'المقاس المقصوص' })
  @IsString({ message: 'المقاس يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'المقاس مطلوب في كل بند' })
  @MaxLength(20, { message: 'المقاس لا يتجاوز 20 حرفًا' })
  size: string;

  @ApiProperty({ example: 3, description: 'عدد الرقصات (layCount ≥ 1)' })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'عدد الرقصات يجب أن يكون بأربع منازل عشرية كحد أقصى' },
  )
  @Min(1, { message: 'عدد الرقصات يجب أن يكون 1 على الأقل' })
  layCount: number;

  @ApiProperty({ example: 25, description: 'القطع في الرقصة الواحدة (موجب)' })
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'قطع الرقصة يجب أن تكون بأربع منازل عشرية كحد أقصى' },
  )
  @IsPositive({ message: 'قطع الرقصة يجب أن تكون رقمًا موجبًا' })
  piecesPerLay: number;

  @ApiPropertyOptional({
    example: 'رقصة قماش أوسط',
    description: 'ملاحظات البند',
  })
  @IsOptional()
  @IsString({ message: 'ملاحظات البند يجب أن تكون نصًا' })
  @MaxLength(300, { message: 'ملاحظات البند لا تتجاوز 300 حرف' })
  notes?: string;
}

/**
 * SELIM-ERP W1 — إنشاء أمر قص (يقلد POST /api/cutting في Selim ERP).
 *
 * الأمر يُنشأ DRAFT بلا أي حركة مخزون — التفعيل (activate) هو من يصرف
 * رصيد الموديل الرئيسي ويُدخل التوليفات داخل معاملة واحدة.
 */
export class CreateCuttingOrderDto {
  @ApiPropertyOptional({
    example: '2026-09-15',
    description: 'تاريخ الأمر (الافتراضي الآن)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'صيغة التاريخ يجب أن تكون ISO 8601' })
  date?: string;

  @ApiProperty({
    example: 'uuid-of-product',
    description: 'الموديل الرئيسي المقصوص',
  })
  @IsUUID(undefined, { message: 'معرف المنتج يجب أن يكون UUID صالحًا' })
  productId: string;

  @ApiProperty({
    example: 'uuid-of-warehouse',
    description: 'مخزن المنتج التام (الصرف والإدخال)',
  })
  @IsUUID(undefined, { message: 'معرف المخزن يجب أن يكون UUID صالحًا' })
  warehouseId: string;

  @ApiPropertyOptional({
    example: 'uuid-of-worker',
    description: 'عامل القص (اختياري — يلزم لأجر القطعة)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف العامل يجب أن يكون UUID صالحًا' })
  workerId?: string;

  @ApiPropertyOptional({
    example: 2.5,
    description: 'أجر القطعة (يلزم مع العامل لحساب أجر القص)',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'أجر القطعة يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @IsPositive({ message: 'أجر القطعة يجب أن يكون رقمًا موجبًا' })
  @Max(100_000, { message: 'أجر القطعة يتجاوز الحد المسموح' })
  wagePerPiece?: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: 'كمية البواقي (نسيج متبقٍ — للمتابعة فقط)',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'كمية البواقي يجب أن تكون بأربع منازل عشرية كحد أقصى' },
  )
  @Min(0, { message: 'كمية البواقي لا يمكن أن تكون سالبة' })
  remnantQty?: number;

  @ApiPropertyOptional({
    example: 'بواقي قماش قابل للاستخدام',
    description: 'ملاحظات البواقي',
  })
  @IsOptional()
  @IsString({ message: 'ملاحظات البواقي يجب أن تكون نصًا' })
  @MaxLength(300, { message: 'ملاحظات البواقي لا تتجاوز 300 حرف' })
  remnantNotes?: string;

  @ApiPropertyOptional({
    example: 'قص طلب عميل النور',
    description: 'ملاحظات الأمر',
  })
  @IsOptional()
  @IsString({ message: 'ملاحظات الأمر يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'ملاحظات الأمر لا تتجاوز 500 حرف' })
  notes?: string;

  @ApiProperty({
    type: [CuttingLineInputDto],
    description: 'بنود القص (بند واحد على الأقل)',
  })
  @IsArray({ message: 'بنود القص يجب أن تكون مصفوفة' })
  @ArrayNotEmpty({ message: 'أمر القص يجب أن يحتوي على بند واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => CuttingLineInputDto)
  lines: CuttingLineInputDto[];
}
