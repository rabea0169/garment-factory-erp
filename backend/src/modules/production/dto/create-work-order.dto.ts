import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateWorkOrderDto {
  @ApiProperty({
    example: 'uuid-of-product',
    description: 'معرف المنتج المراد تصنيعه',
  })
  @IsUUID(undefined, { message: 'معرف المنتج يجب أن يكون UUID صالحًا' })
  productId: string;

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
