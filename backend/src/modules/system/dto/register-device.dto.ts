import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * SELIM-ERP W3 — تسجيل جهاز (يقلد POST /api/devices/register في Selim).
 * deviceId معرّف مستقر يولّده العميل ويحفظه محليًا — upsert على المفتاح
 * الفريد يحدّث آخر ظهور بدل تكرار الأجهزة.
 * تكييف: isStandalone (مفهوم PWA) استُبدل بـ appVersion (إصدار Flutter).
 */
export class RegisterDeviceDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsString()
  @IsNotEmpty()
  @Length(8, 100)
  deviceId!: string;

  @ApiPropertyOptional({ example: 'Dart/3.5 (dio)' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  userAgent?: string;

  @ApiPropertyOptional({
    example: 'android',
    description: 'android | ios | windows | macos | linux | web',
  })
  @IsOptional()
  @IsString()
  @Length(0, 30)
  platform?: string;

  @ApiPropertyOptional({ example: 'ar' })
  @IsOptional()
  @IsString()
  @Length(0, 10)
  language?: string;

  @ApiPropertyOptional({ example: 1080 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  screenWidth?: number;

  @ApiPropertyOptional({ example: 2400 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  screenHeight?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isMobile?: boolean;

  @ApiPropertyOptional({ example: '1.4.0+7' })
  @IsOptional()
  @IsString()
  @Length(0, 30)
  appVersion?: string;
}
