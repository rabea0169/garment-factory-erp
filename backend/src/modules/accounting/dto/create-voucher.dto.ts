import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VoucherType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
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

  // A3: ربط السند بالخزينة (إلزامي) — كل سند يُحدّث رصيد خزينة.
  @ApiProperty({
    example: '00000000-0000-0000-0000-000000000001',
    description: 'معرف الخزينة المرتبطة بالسند',
  })
  @IsUUID('4', { message: 'معرف الخزينة يجب أن يكون UUID صالح' })
  treasuryId: string;

  @ApiPropertyOptional({
    enum: ['CUSTOMER', 'SUPPLIER', 'WORKER'],
    example: 'CUSTOMER',
    description: 'نوع الطرف المقابل (اختياري — السند النثري بلا طرف)',
  })
  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER', 'WORKER'], {
    message: 'نوع الطرف المقابل يجب أن يكون CUSTOMER أو SUPPLIER أو WORKER',
  })
  counterpartyType?: 'CUSTOMER' | 'SUPPLIER' | 'WORKER';

  @ApiPropertyOptional({
    example: '00000000-0000-0000-0000-000000000099',
    description: 'معرف الطرف المقابل (UUID — مطلوب مع counterpartyType)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'معرف الطرف المقابل يجب أن يكون UUID صالح' })
  counterpartyId?: string;

  // ملاحظة P0-04: createdById لا يقبل من العميل — من الجلسة (@CurrentUser).
  // إرساله في body يرفض بـ 400 (forbidNonWhitelisted) — أقوى من التجاهل.
}
