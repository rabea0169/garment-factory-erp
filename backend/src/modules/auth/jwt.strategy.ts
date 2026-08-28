import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

const MIN_JWT_SECRET_LENGTH = 32;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // fail-closed: لا fallback لسر JWT إطلاقًا (P0-02)
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_SECRET غير معرف في البيئة. انسخ backend/.env.example إلى backend/.env وحدد قيمة عشوائية (openssl rand -base64 48). لا يوجد fallback أمني.',
      );
    }
    if (
      process.env.NODE_ENV === 'production' &&
      secret.length < MIN_JWT_SECRET_LENGTH
    ) {
      throw new Error(
        `JWT_SECRET قصير جدًا للإنتاج (${secret.length} حرفًا، الحد الأدنى ${MIN_JWT_SECRET_LENGTH}). استخدم قيمة عشوائية أطول.`,
      );
    }
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      console.warn(
        `[security] JWT_SECRET أقصر من ${MIN_JWT_SECRET_LENGTH} حرفًا — غير مقبول في الإنتاج (فشل إقلاع هناك).`,
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: { sub: string; email: string; v?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('المستخدم غير مصرح له بالدخول');
    }

    // SEC-F04: revoke-by-version — لو payload.v يختلف عن user.jwtVersion،
    // فالـ access token قد بُطّل بعد logout. نرفض الطلب ونُجبر العميل على refresh.
    if (
      typeof payload.v === 'number' &&
      Number.isFinite(payload.v) &&
      payload.v !== user.jwtVersion
    ) {
      throw new UnauthorizedException(
        'انتهت صلاحية الجلسة — سجّل دخولك من جديد أو استعمل refresh_token',
      );
    }

    // إزالة كلمة المرور من كائن المستخدم المرجع
    const { password, ...result } = user;
    return result;
  }
}
