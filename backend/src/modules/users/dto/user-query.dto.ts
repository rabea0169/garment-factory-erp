import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * CC-9 (P1 — GF-IMP-W2): مرشحات قائمة المستخدمين (SUPER_ADMIN فقط).
 *
 * يرث ترقيم الصفحات من PaginationDto (page/limit بحد أقصى 100) ويضيف
 * فلترين اختياريين: role (قيمة من UserRole) وisActive (boolean).
 * isActive يصل من query string نصًا ("true"/"false") — Transform يحوّله
 * قبل IsBoolean لأن @Type(() => Boolean) يحوّل أي نص غير فارغ إلى true.
 */
export class UserQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: UserRole,
    example: UserRole.VIEWER,
    description: 'تصفية بالدور',
  })
  @IsOptional()
  @IsEnum(UserRole, { message: 'الدور غير صالح' })
  role?: UserRole;

  @ApiPropertyOptional({
    example: true,
    description: 'تصفية بحالة النشاط (isActive)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    // قيمة خام أخرى تُترك كما هي — IsBoolean أدناه يرفضها برسالة واضحة
    return value as boolean;
  })
  @IsBoolean({ message: 'قيمة isActive يجب أن تكون true أو false' })
  isActive?: boolean;
}
