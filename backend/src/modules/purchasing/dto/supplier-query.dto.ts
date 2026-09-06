import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

/**
 * PUR-7 (ج) (P2 — GF-IMP-W3): مرشحات قائمة الموردين.
 *
 * CC-6: يرث القالب الموحد (page/limit/from/to/q — الفترة على createdAt
 * والبحث الحر على name/code/phone) ويضيف includeInactive.
 *
 * الافتراضي: النشطون فقط (isActive=true, deletedAt=null) — هذا هو شكل
 * شاشات الاختيار (إنشاء أمر شراء/مرتجع). includeInactive=true يضم
 * غير النشطين (المعطّلون إداريًا) للشاشات الإدارية؛ المحذوفون ناعمًا
 * (deletedAt ≠ null) مستثنون دائمًا.
 */
export class SupplierQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    example: true,
    description: 'ضم الموردين غير النشطين (الافتراضي false — النشطون فقط)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    // قيمة خام أخرى تُترك كما هي — IsBoolean أدناه يرفضها برسالة واضحة
    return value as boolean;
  })
  @IsBoolean({ message: 'قيمة includeInactive يجب أن تكون true أو false' })
  includeInactive?: boolean;
}
