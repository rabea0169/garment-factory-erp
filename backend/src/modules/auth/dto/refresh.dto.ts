import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * SEC-F04: DTO لمساري /auth/refresh و /auth/logout.
 * refresh_token هو القيمة الأصلية (96 hex chars) التي أُرجعت من /auth/login.
 */
export class RefreshDto {
  @ApiProperty({
    description: 'refresh token كما أُرجع من /auth/login',
    example: 'a1b2c3d4...96 chars hex',
    minLength: 32,
  })
  @IsString()
  @MinLength(32)
  refresh_token!: string;
}
