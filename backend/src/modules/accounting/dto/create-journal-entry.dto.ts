import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class JournalLineDto {
  // IsUUID('loose'): حسابات النظام الافتراضية (CHART_OF_ACCOUNTS) تحمل
  // معرفات ثابتة version-0 مثل 10000000-0000-0000-0000-000000000031 —
  // صالحة تمامًا لعمود uuid في PostgreSQL، لكن class-validator >= 0.15
  // (مع validator.js الجديد) صار يرفضها في وضع "all". اكتُشف هذا كسرًا
  // فعليًا على الإنتاج عند محاولة قيد يدوي على حساب نظامي (400). النمط
  // 'loose' = نسق 8-4-4-4-12 hex كاملًا — كل ما يقبله العمود أصلًا.
  @ApiProperty({ example: '10000000-0000-0000-0000-000000000031' })
  @IsUUID('loose')
  debitAccountId: string;

  @ApiProperty({ example: '30000000-0000-0000-0000-000000000001' })
  @IsUUID('loose')
  creditAccountId: string;

  @ApiProperty({ example: 1250.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'قيد تكلفة تشغيل' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateJournalEntryDto {
  @ApiProperty({ example: 'قيد تكلفة خامات' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'WO-2026-001' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty({ example: 'uuid-fiscal-period' })
  @IsUUID()
  fiscalPeriodId: string;

  @ApiPropertyOptional({ example: '2026-08-26T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ type: [JournalLineDto], maxItems: 500, minItems: 1 })
  // ACC-10 (P2 — GF-IMP-W3): سقف صريح لمصفوفة البنود — لا قيد فارغ (بند
  // واحد على الأقل) ولا قيد عملاق يُرهق $transaction الواحدة (500 بندًا
  // كحد أقصى). الرسائل عربية لتظهر كما هي في استجابة 400.
  @IsArray()
  @ArrayMinSize(1, { message: 'القيد يجب أن يحتوي على بندًا واحدًا على الأقل' })
  @ArrayMaxSize(500, { message: 'القيد لا يمكن أن يتجاوز 500 بند' })
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}
