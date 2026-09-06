import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * CC-9 (P1 — GF-IMP-W2): إنشاء مستخدم عبر API بدل SQL اليدوي.
 *
 * كلمة المرور تُقبل هنا فقط ولا تُعاد في أي قراءة أبدًا (select صريح
 * بلا عمود كلمة المرور في كل مسارات القراءة في UsersService).
 */
export class CreateUserDto {
  @ApiProperty({ example: 'سارة أحمد', description: 'اسم المستخدم' })
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  @MaxLength(120)
  name: string;

  @ApiProperty({
    example: 'sara@factory.com',
    description: 'البريد الإلكتروني (فريد)',
  })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  @MaxLength(190)
  email: string;

  @ApiProperty({
    example: 'Pass@123',
    description: 'كلمة المرور (تُخزَّن bcrypt فقط ولا تُعاد أبدًا)',
  })
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  @MaxLength(72, { message: 'كلمة المرور أطول من حد bcrypt (72 بايت)' })
  password: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.INVENTORY_MANAGER,
    description: 'دور المستخدم — يجب أن يكون قيمة من UserRole في المخطط',
  })
  @IsEnum(UserRole, {
    message: 'الدور غير صالح — يجب أن يكون إحدى قيم UserRole المعرفة في المخطط',
  })
  role: UserRole;
}
