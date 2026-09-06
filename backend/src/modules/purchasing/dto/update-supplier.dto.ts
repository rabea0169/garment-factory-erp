import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PUR-7 (أ) (P2 — GF-IMP-W3): تحديث بيانات مورد — تكافؤ مع PATCH
 * /customers/:id في موديول المبيعات.
 *
 * كل الحقول اختيارية (patch دلاليًا) لكن اسم واحد على الأقل من الأربعة
 * يجب أن يُرسل — الخدمة ترفض طلبًا بلا أي حقل بـ 400 (تحديث فارغ).
 * الاسم إذا أُرسل لا يقبل فارغًا/مسافات فقط (IsNotEmpty بعد trim في
 * الخدمة). الحقول غير المرسلة لا تُمسّ أبدًا.
 */
export class UpdateSupplierDto {
  @ApiPropertyOptional({
    example: 'شركة النسيج المتحدة',
    description: 'اسم المورد الجديد',
  })
  @IsOptional()
  @IsString({ message: 'اسم المورد يجب أن يكون نصًا' })
  @IsNotEmpty({ message: 'اسم المورد لا يمكن أن يكون فارغًا' })
  @MaxLength(200, { message: 'اسم المورد لا يتجاوز 200 حرف' })
  name?: string;

  @ApiPropertyOptional({
    example: '01000000000',
    description: 'رقم الهاتف الجديد',
  })
  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصًا' })
  @MaxLength(30, { message: 'رقم الهاتف لا يتجاوز 30 حرفًا' })
  phone?: string;

  @ApiPropertyOptional({ example: 'القاهرة', description: 'العنوان الجديد' })
  @IsOptional()
  @IsString({ message: 'العنوان يجب أن يكون نصًا' })
  @MaxLength(300, { message: 'العنوان لا يتجاوز 300 حرف' })
  address?: string;

  @ApiPropertyOptional({
    example: 'توريد أقمشة قطنية',
    description: 'الملاحظات الجديدة',
  })
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  @MaxLength(500, { message: 'الملاحظات لا تتجاوز 500 حرف' })
  notes?: string;
}
