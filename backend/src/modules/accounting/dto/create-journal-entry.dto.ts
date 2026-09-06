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
  @ApiProperty({ example: 'uuid-debit-account' })
  @IsUUID()
  debitAccountId: string;

  @ApiProperty({ example: 'uuid-credit-account' })
  @IsUUID()
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
