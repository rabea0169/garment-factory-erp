import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W3 — تحديث إعدادات المصنع (يقلد PUT /api/factory-settings
 * في Selim مع تكييفات الأمان أدناه).
 *
 * تكييفات مقصودة عن المرجع:
 * - الشعار يُستقبل data-URL (image/*) بحد 512KB — المرجع يكتب الملف إلى
 *   public/uploads على القرص (منطقة زائلة على Railway ولا تُخدَّم في
 *   الإنتاج) — نرفض ذلك كخطأ ونخزّن data-URL في القاعدة.
 * - taxRate نسبة مئوية (0-100) وليست كسرًا عشريًا — نفس عرض واجهة Selim.
 */
export class UpdateFactorySettingsDto {
  @ApiPropertyOptional({ example: 'مصنع سليم للملابس' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  factoryName?: string;

  @ApiPropertyOptional({ example: 'Selim Garments' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  factoryNameEn?: string;

  @ApiPropertyOptional({ example: 'جودة تلبسها' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  slogan?: string;

  @ApiPropertyOptional({ example: '01000000000' })
  @IsOptional()
  @IsString()
  @Matches(/^[+\d\s()-]{0,25}$/, { message: 'رقم هاتف غير صالح' })
  phone?: string;

  @ApiPropertyOptional({ example: '201000000000' })
  @IsOptional()
  @IsString()
  @Matches(/^[+\d\s()-]{0,25}$/, { message: 'رقم واتساب غير صالح' })
  whatsapp?: string;

  @ApiPropertyOptional({ example: 'info@factory.com' })
  @IsOptional()
  @IsString()
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'بريد إلكتروني غير صالح' })
  email?: string;

  @ApiPropertyOptional({ example: 'القاهرة — العبور' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  address?: string;

  @ApiPropertyOptional({ example: '123-456-789' })
  @IsOptional()
  @IsString()
  @Length(0, 40)
  taxNumber?: string;

  @ApiPropertyOptional({ example: '98765' })
  @IsOptional()
  @IsString()
  @Length(0, 40)
  commercialRegister?: string;

  @ApiPropertyOptional({
    description: 'شعار المصنع data-URL (image/*) — حد 512KB',
  })
  @IsOptional()
  @IsString()
  logo?: string;

  @ApiPropertyOptional({ example: 'ج.م' })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  currency?: string;

  @ApiPropertyOptional({ example: 'INV-' })
  @IsOptional()
  @IsString()
  @Length(0, 12)
  invoicePrefix?: string;

  @ApiPropertyOptional({ example: 'شكرًا لتعاملكم معنا' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  invoiceFooter?: string;

  @ApiPropertyOptional({ enum: ['A4', 'A5'] })
  @IsOptional()
  @IsString()
  @Matches(/^(A4|A5)$/, { message: 'حجم الورق يجب أن يكون A4 أو A5' })
  defaultPaperSize?: string;

  @ApiPropertyOptional({ description: 'تفعيل QR الفاتورة على الإيصارات' })
  @IsOptional()
  @IsBoolean()
  enableInvoiceQr?: boolean;

  @ApiPropertyOptional({
    example: 14,
    description: 'نسبة الضريبة % (0-100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  taxRate?: number;
}
