import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * SELIM-ERP W1 — فترات الميزانية (مطابقة لتعليق Budget.period في
 * prisma/schema.prisma).
 */
export const BUDGET_PERIODS = ['monthly', 'quarterly', 'yearly'] as const;

/**
 * SELIM-ERP W1 — إنشاء ميزانية (يقلد POST /api/financial-reports/budgets
 * في Selim ERP): مبلغ مخطط لحساب ورقة (ومركز تكلفة اختياري) لسنة مالية
 * وفترة محددة — التفرد لكل (حساب، سنة، فترة، رقم فترة).
 */
export class CreateBudgetDto {
  @ApiProperty({
    example: '50000000-0000-0000-0000-000000000031',
    description: 'معرف الحساب (يجب أن يكون حسابًا ورقة غير تجميعي)',
  })
  @IsUUID(undefined, { message: 'معرف الحساب يجب أن يكون UUID صالحًا' })
  accountId: string;

  @ApiPropertyOptional({
    example: 'uuid-of-cost-center',
    description: 'مركز التكلفة (اختياري)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف مركز التكلفة يجب أن يكون UUID صالحًا' })
  costCenterId?: string;

  @ApiProperty({ example: 2026, description: 'السنة المالية' })
  @Type(() => Number)
  @IsInt({ message: 'السنة المالية يجب أن تكون عددًا صحيحًا' })
  @Min(2000, { message: 'السنة المالية ≥ 2000' })
  @Max(2100, { message: 'السنة المالية ≤ 2100' })
  fiscalYear: number;

  @ApiProperty({
    enum: BUDGET_PERIODS,
    description: 'الفترة (افتراضي yearly)',
  })
  @IsIn(BUDGET_PERIODS, {
    message: 'نوع الفترة يجب أن يكون monthly أو quarterly أو yearly',
  })
  period: string;

  @ApiProperty({
    example: 1,
    description: 'رقم الفترة: الشهر 1-12 / الربع 1-4 / السنة 1',
  })
  @Type(() => Number)
  @IsInt({ message: 'رقم الفترة يجب أن يكون عددًا صحيحًا' })
  @Min(1, { message: 'رقم الفترة ≥ 1' })
  periodIndex: number;

  @ApiProperty({
    example: 50000,
    description: 'المبلغ المخطط (موجب)',
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'مبلغ الميزانية يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0.01, { message: 'مبلغ الميزانية يجب أن يكون موجبًا' })
  amount: number;
}

/**
 * SELIM-ERP W1 — تعديل ميزانية: المبلغ (و/أو مركز التكلفة) فقط —
 * (الحساب/السنة/الفترة) هوية الميزانية: تعديلها = حذف + إنشاء.
 */
export class UpdateBudgetDto {
  @ApiPropertyOptional({ example: 55000, description: 'المبلغ المخطط الجديد' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'مبلغ الميزانية يجب أن يكون بمنزلتين عشريتين كحد أقصى' },
  )
  @Min(0.01, { message: 'مبلغ الميزانية يجب أن يكون موجبًا' })
  amount?: number;

  @ApiPropertyOptional({
    example: 'uuid-of-cost-center',
    description: 'ربط بمركز تكلفة (null = فك الربط — أرسل null صراحة)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف مركز التكلفة يجب أن يكون UUID صالحًا' })
  costCenterId?: string | null;
}

/**
 * SELIM-ERP W1 — مرشحات قائمة الميزانيات: سنة/حساب/فترة + ترقيم.
 */
export class QueryBudgetDto extends PaginationDto {
  @ApiPropertyOptional({ example: 2026, description: 'السنة المالية' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'السنة المالية يجب أن تكون عددًا صحيحًا' })
  @Min(2000, { message: 'السنة المالية ≥ 2000' })
  fiscalYear?: number;

  @ApiPropertyOptional({
    example: 'uuid-of-account',
    description: 'فلترة الحساب',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الحساب يجب أن يكون UUID صالحًا' })
  accountId?: string;

  @ApiPropertyOptional({
    enum: BUDGET_PERIODS,
    description: 'فلترة نوع الفترة',
  })
  @IsOptional()
  @IsIn(BUDGET_PERIODS, {
    message: 'نوع الفترة يجب أن يكون monthly أو quarterly أو yearly',
  })
  period?: string;
}

/**
 * SELIM-ERP W1 — تقرير تباين الميزانية: السنة المالية مطلوبة (كل
 * الميزانيات المخططة لتلك السنة مقابل الفعلي من القيود).
 */
export class BudgetVarianceQueryDto {
  @ApiProperty({ example: 2026, description: 'السنة المالية' })
  @Type(() => Number)
  @IsInt({ message: 'السنة المالية يجب أن تكون عددًا صحيحًا' })
  @Min(2000, { message: 'السنة المالية ≥ 2000' })
  @Max(2100, { message: 'السنة المالية ≤ 2100' })
  fiscalYear: number;
}
