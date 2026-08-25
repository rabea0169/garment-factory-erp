import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VoucherType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class CreateVoucherDto {
  @ApiProperty({
    enum: VoucherType,
    example: VoucherType.PAYMENT,
    description: 'نوع السند (صرف/قبض)',
  })
  @IsEnum(VoucherType, { message: 'نوع السند يجب أن يكون PAYMENT أو RECEIPT' })
  type: VoucherType;

  @ApiProperty({ example: 500, description: 'المبلغ (يجب أن يكون موجبًا)' })
  @IsPositive({ message: 'المبلغ يجب أن يكون رقمًا موجبًا' })
  amount: number;

  @ApiProperty({ example: 'صرف نثريات', description: 'الوصف' })
  @IsString()
  @IsNotEmpty({ message: 'الوصف مطلوب' })
  description: string;

  @ApiPropertyOptional({
    example: 'REF-123',
    description: 'مرجع خارجي (اختياري)',
  })
  @IsOptional()
  @IsString()
  reference?: string;

  // ملاحظة P0-04: createdById لا يقبل من العميل — من الجلسة (@CurrentUser).
  // إرساله في body يرفض بـ 400 (forbidNonWhitelisted) — أقوى من التجاهل.
}
