import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** مستوى السعر المستخدم في نقطة البيع — يقلد price level في Selim POS. */
export enum PosPriceLevel {
  RETAIL = 'RETAIL',
  WHOLESALE = 'WHOLESALE',
}

/** بند سلة نقطة البيع — توليفة + كمية (السعر يُحسب خادميًا). */
export class PosSaleItemDto {
  @IsUUID()
  productVariantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;
}

/**
 * SELIM-ERP W2 — بيع سريع من نقطة البيع.
 *
 * البيع نقدي فوري: يُنشأ أمر البيع **مؤكدًا مباشرة** (لا مسودة ولا خطوة
 * اعتماد) — نفس سلوك Selim POS. فصل الواجبات SAL-4 لا ينطبق هنا لأنه لا
 * يوجد اعتماد ذاتي: المعاملة نقدية مكملة لحظة البيع (توثيق التكييف في
 * SELIM_REPLICATION.md).
 */
export class QuickSaleDto {
  /** عميل مسجل (اختياري) — عند الغياب يُستخدم عميل النقدي walk-in. */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items!: PosSaleItemDto[];

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  discount?: number = 0;

  @IsOptional()
  @IsEnum(PosPriceLevel)
  priceLevel?: PosPriceLevel = PosPriceLevel.RETAIL;

  /** ملاحظة تُطبع على الإيصار (اسم بائع/وردية...). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}
