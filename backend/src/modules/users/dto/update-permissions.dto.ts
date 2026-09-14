import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * SELIM-ERP W4: DTO تحديث الصلاحيات التفصيلية لمستخدم — نقل
 * permissionsUpdateSchema من المرجع: صف صفوف { resource, action }.
 * resource سلسلة معروفة (أو '*')، action من الأفعال الستة (أو '*') —
 * مع تنقية دفاعية إضافية في الخدمة (normalizeStoredPermissions)
 * تسقط أي صف دخيل بلا رفض الطلب كله (نفس تسامح المرجع مع aliases).
 */
export class PermissionRowDto {
  @ApiProperty({ example: 'sales', description: 'المورد أو "*"' })
  @IsString()
  @MaxLength(40)
  resource!: string;

  @ApiProperty({
    example: 'READ',
    enum: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'APPROVE', '*'],
  })
  @IsIn(['READ', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'APPROVE', '*'])
  action!: string;
}

export class UpdatePermissionsDto {
  @ApiProperty({
    description:
      'صف الصلاحيات [{ resource, action }] — [] يعني العودة لافتراضيات الدور',
    example: [{ resource: 'sales', action: 'READ' }],
    maxItems: 300,
  })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(300, { message: 'عدد الصلاحيات كبير جدًا (الحد 300 صفًا)' })
  @ValidateNested({ each: true })
  @Type(() => PermissionRowDto)
  permissions!: PermissionRowDto[];
}
