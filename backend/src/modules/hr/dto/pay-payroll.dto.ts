import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class PayPayrollDto {
  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000001',
    description:
      'معرف الخزينة التي سيُخصم منها صافي الراتب — اختياري عند صافٍ = صفر (HR-4: تسوية السلف بلا نقد)',
  })
  // HR-4 (P2 — GF-IMP-W3): الخزينة اختيارية — كشف بصافٍ صفر (السلف غطت
  // الإجمالي) يُسوّى بلا أي حركة نقدية. الخدمة ترفض 400 عند صافٍ موجب
  // بلا خزينة.
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الخزينة يجب أن يكون UUID صالحًا' })
  treasuryId?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'تاريخ الدفع بصيغة ISO، والافتراضي تاريخ التنفيذ',
  })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ الدفع يجب أن يكون تاريخ ISO صالحًا' })
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'صرف راتب أغسطس' })
  @IsOptional()
  @IsString({ message: 'ملاحظات الدفع يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'ملاحظات الدفع تتجاوز 500 حرف' })
  notes?: string;
}

// لا يقبل الـDTO مبلغًا أو workerId أو createdById؛ المبلغ والهوية من الخادم.
