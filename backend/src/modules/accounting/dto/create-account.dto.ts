import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ example: '1200', description: 'كود الحساب' })
  @IsString()
  @IsNotEmpty({ message: 'كود الحساب مطلوب' })
  code: string;

  @ApiProperty({ example: 'ذمم العملاء', description: 'اسم الحساب' })
  @IsString()
  @IsNotEmpty({ message: 'اسم الحساب مطلوب' })
  name: string;

  @ApiProperty({
    enum: AccountType,
    example: AccountType.ASSET,
    description: 'نوع الحساب',
  })
  @IsEnum(AccountType, {
    message:
      'نوع الحساب يجب أن يكون ASSET أو LIABILITY أو EQUITY أو REVENUE أو EXPENSE',
  })
  type: AccountType;

  @ApiPropertyOptional({
    example: 'uuid-of-parent',
    description: 'معرف الحساب الأب (اختياري)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'معرف الحساب الأب يجب أن يكون UUID صالحًا' })
  parentId?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'هل هو حساب مجموعة؟ (اختياري)',
  })
  @IsOptional()
  @IsBoolean({ message: 'isGroup يجب أن يكون قيمة منطقية' })
  isGroup?: boolean;
}
