import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateWorkOrderDto {
  @ApiProperty({
    example: 'uuid-of-variant',
    description: 'معرف النسخة (SKU) المراد تصنيعها',
  })
  @IsUUID(undefined, { message: 'معرف النسخة يجب أن يكون UUID صالحًا' })
  productVariantId: string;

  @ApiProperty({
    example: 'uuid-of-bom-version',
    description: 'معرف إصدار الوصفة (BOM Version)',
  })
  @IsUUID(undefined, { message: 'معرف الإصدار يجب أن يكون UUID صالحًا' })
  bomVersionId: string;

  @ApiProperty({
    example: 100,
    description: 'الكمية المطلوب تصنيعها (عدد صحيح موجب)',
  })
  @IsInt({ message: 'الكمية يجب أن تكون عددًا صحيحًا' })
  @IsPositive({ message: 'الكمية يجب أن تكون عددًا موجبًا' })
  quantity: number;

  // ملاحظة P0-04: creatorId لا يقبل من العميل — يُستخرج من الجلسة (@CurrentUser).
  // إرسال أي حقل هوية في body يرفض بـ 400 (forbidNonWhitelisted).
}
