import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from './pagination.dto';

/**
 * CC-6 (P2 — GF-IMP-W3): قالب الاستعلام الموحد للقوائم المقسمة بمرشحات.
 *
 * عقد الالتزام: كل قوائم الموجات اللاحقة (وكل وكيل يطبّق CC-6 على قوائمه)
 * ترث هذا القالب وتلتزم به:
 * - `page` / `limit` — ترقيم بحد أقصى 100 عنصر (موروث من PaginationDto).
 * - `from` / `to` — فترة اختيارية بصيغة ISO 8601؛ عمود التاريخ الذي تُطبَّق
 *   عليه الفترة يحدده كل مورد (createdAt عادةً) ويوثَّق في DTO الابن.
 *   الخدمة تتحقق أن from ≤ to وإلا 400.
 * - `q` — نص بحث حر اختياري؛ الحقول المبحوثة يحددها كل مورد ويوثّقها.
 *
 * DTO الابن يضيف مرشحاته النوعية (status / supplierId / includeInactive ...)
 * فوق هذا الأساس — لا يعيد تعريف page/limit/from/to/q.
 */
export class ListQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00Z',
    description:
      'بداية الفترة (ISO 8601) — عمود التاريخ يحدده كل مورد (createdAt عادةً)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ البداية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59Z',
    description: 'نهاية الفترة (ISO 8601) — تُتحقق الخدمة أن from ≤ to',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'تاريخ النهاية يجب أن يكون بصيغة ISO 8601 صالحة' },
  )
  to?: string;

  @ApiPropertyOptional({
    example: 'SHP-2026',
    description:
      'نص بحث حر اختياري — الحقول المبحوثة (code/name/trackingNumber ...) يحددها كل مورد',
  })
  @IsOptional()
  @IsString({ message: 'نص البحث يجب أن يكون نصًا' })
  @MaxLength(100, { message: 'نص البحث لا يتجاوز 100 حرف' })
  q?: string;
}
