import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';

/**
 * C1: باكيت الأمان auth — 10 محاولات/دقيقة لكل IP لتقييد brute-force
 * على POST /auth/login. يضيّق named default throttle (100/min) لهذا المسار فقط.
 */
@ApiTags('Auth (المصادقة)')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'إرجاع بيانات المستخدم الحالي' })
  @ApiResponse({ status: 200, description: 'بيانات المستخدم المصادق عليه' })
  me(@CurrentUser() user: Record<string, unknown>) {
    return user;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الدخول للموظفين والإدارة' })
  @ApiResponse({
    status: 200,
    description: 'تم تسجيل الدخول بنجاح وإرجاع الـ Token',
  })
  @ApiResponse({ status: 401, description: 'بيانات الدخول غير صحيحة' })
  @ApiResponse({
    status: 429,
    description: 'تجاوز حد المعدل (10 محاولات/دقيقة) — انتظر ثم أعد المحاولة',
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
