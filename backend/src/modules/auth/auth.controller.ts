import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import type { Request } from 'express';

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
    description: 'تم تسجيل الدخول بنجاح وإرجاع الـ access + refresh tokens',
  })
  @ApiResponse({ status: 401, description: 'بيانات الدخول غير صحيحة' })
  @ApiResponse({
    status: 429,
    description: 'تجاوز حد المعدل (10 محاولات/دقيقة) — انتظر ثم أعد المحاولة',
  })
  async login(@Body() loginDto: LoginDto, @Req() req?: Request) {
    return this.authService.login(loginDto, extractMeta(req));
  }

  /**
   * SEC-F04: تدوير الـ refresh token بآخر جديد (rotation).
   * - مسار عام (@Public) لكنه يطالب بـ refresh_token صالح في الجسم.
   * - throttle 30/دقيقة — أعلى من login لأنه طبيعي أن يُستدعى كثيرًا عند العودة للتطبيق.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تدوير الـ refresh token وإصدار access جديد' })
  @ApiResponse({
    status: 200,
    description: 'إصدار زوج access+refresh جديد؛ الـ token القديم يُلغى',
  })
  @ApiResponse({
    status: 401,
    description: 'refresh_token غير صالح أو منتهي أو ملغى',
  })
  async refresh(@Body() dto: RefreshDto, @Req() req?: Request) {
    return this.authService.refresh(dto.refresh_token, extractMeta(req));
  }

  /**
   * SEC-F04: تسجيل الخروج — يلغي الـ refresh token المُمرر ويرفع jwtVersion
   * فيبطل كل الـ access tokens الصادرة قبل ذلك.
   * idempotent: إعادة الاستدعاء بـ token ملغى أو غير موجود ترجع 200.
   * مسار عام لأن المستخدم قد يستدعيه بـ access token منتهٍ — نُميّل
   * التحقق إلى الـ refresh_token في الجسم وحده.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الخروج وإبطال الـ refresh token' })
  @ApiResponse({
    status: 200,
    description: 'تم إلغاء الـ token أو كان ملغى أصلًا',
  })
  async logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refresh_token);
  }
}

function extractMeta(req?: Request): { userAgent?: string; ip?: string } {
  if (!req) return {};
  const headers = req.headers ?? {};
  return {
    userAgent:
      typeof headers['user-agent'] === 'string'
        ? headers['user-agent']
        : undefined,
    ip:
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] ??
      req.ip ??
      req.socket?.remoteAddress,
  };
}
