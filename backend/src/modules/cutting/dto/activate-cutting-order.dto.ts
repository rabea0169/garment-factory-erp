import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * SELIM-ERP W1 — DTO تفعيل أمر قص (يقلد POST /api/cutting/:id/activate في
 * Selim ERP).
 *
 * تكيف مقصود (موثق): رصيد Selim يعيش على «الموديل الرئيسي» بينما مخزوننا
 * يعيش على مستوى التوليفة (FinishedGoodStock لكل productVariantId). القص
 * عندنا يستهلك رصيد توليفة واحدة «مصدر»:
 * - إن أرسل العميل sourceVariantId تُستخدم هذه التوليفة (يجب أن تنتمي
 *   للموديل نفسه).
 * - وإلا تُختار تلقائيًا توليفة الموديل صاحبة أكبر رصيد في المخزن.
 */
export class ActivateCuttingOrderDto {
  @ApiPropertyOptional({
    example: 'uuid-of-variant',
    description:
      'التوليفة المصدر التي يُخصم منها رصيد الموديل (اختياري — الافتراضي: أكبر رصيد)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف التوليفة يجب أن يكون UUID صالحًا' })
  sourceVariantId?: string;
}
