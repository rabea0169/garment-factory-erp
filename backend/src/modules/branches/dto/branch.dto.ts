import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * SELIM-ERP W4: DTO فروع الشركة — نقل branchCreateSchema/branchUpdateSchema
 * من المرجع (SPRINT 89) بمعمارية أحادية المستأجر (لا companyId).
 * الاسم مطلوب (2-80 حرفًا)؛ البقية نصوص اختيارية تُقصَّ قبل الحفظ.
 */
export class CreateBranchDto {
  @ApiProperty({ description: 'اسم الفرع (مثال: فرع القاهرة)', minLength: 2 })
  @IsString()
  @MinLength(2, { message: 'اسم الفرع يجب ألا يقل عن حرفين' })
  @MaxLength(80, { message: 'اسم الفرع يجب ألا يتجاوز 80 حرفًا' })
  name!: string;

  @ApiPropertyOptional({ description: 'عنوان الفرع' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ description: 'هاتف الفرع' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ description: 'مسؤول الفرع (نص حر كما في المرجع)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  manager?: string;

  @ApiPropertyOptional({
    description: 'الفرع الرئيسي — تعيينه يلغي رئيسية باقي الفروع',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional({
    description: 'نشط (يظهر في المنتقي أم لا)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * تحديث فرع — كل الحقول اختيارية (Patch جزئي كما في المرجع).
 * تحديد isMain=true يلغي رئيسية الفروع الأخرى (transaction).
 */
export class UpdateBranchDto {
  @ApiPropertyOptional({ description: 'اسم الفرع' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'اسم الفرع يجب ألا يقل عن حرفين' })
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: 'العنوان — null يمسحه' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({ description: 'الهاتف — null يمسحه' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ description: 'المسؤول — null يمسحه' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  manager?: string | null;

  @ApiPropertyOptional({ description: 'تعيين فرعًا رئيسيًا (يلغي غيره)' })
  @IsOptional()
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional({ description: 'تعطيل/تنشيط الفرع' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
