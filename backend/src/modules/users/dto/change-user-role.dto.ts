import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * CC-9 (P1 — GF-IMP-W2): تغيير دور مستخدم قائم (SUPER_ADMIN فقط).
 * لا يمكن للمستخدم تغيير دوره الخاص — يُرفض في الخدمة بـ 409.
 */
export class ChangeUserRoleDto {
  @ApiProperty({
    enum: UserRole,
    example: UserRole.ACCOUNTANT,
    description: 'الدور الجديد — قيمة من UserRole في المخطط',
  })
  @IsEnum(UserRole, {
    message: 'الدور غير صالح — يجب أن يكون إحدى قيم UserRole المعرفة في المخطط',
  })
  role: UserRole;
}
