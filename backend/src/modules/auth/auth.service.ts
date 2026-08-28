import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';

/**
 * SEC-F04: مدة صلاحية الـ refresh token — 30 يومًا افتراضيًا،
 * يمكن تجاوزها عبر REFRESH_TOKEN_DAYS (env).
 */
const REFRESH_TOKEN_TTL_DAYS = Number.parseInt(
  process.env.REFRESH_TOKEN_DAYS ?? '30',
  10,
);
const REFRESH_TOKEN_BYTES = 48; // 96 hex chars — 384-bit entropy

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto, meta?: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('هذا الحساب تم إيقافه، راجع الإدارة');
    }

    // SEC-F04: ضم jwtVersion إلى payload يسمح بـ revocation جماعي عند logout.
    // JwtStrategy.validate يقارن payload.v مع user.jwtVersion.
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      v: user.jwtVersion,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.issueRefreshToken(user.id, meta);

    const { password, ...result } = user;

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: result,
    };
  }

  /**
   * SEC-F04: استبدال الـ refresh token بآخر جديد (rotation).
   * - يتحقق أن الـ token الأصلي موجود، غير منتهي، وغير ملغى.
   * - يصدر access_token + refresh_token جديدين.
   * - يلغي الـ token القديم ويربطه بالجديد عبر replacedBy.
   * - يرفض الـ token الملغى (كشف محاولة إعادة استخدامه) بـ 401 — إشارة لسرقة محتملة.
   */
  async refresh(
    refreshTokenValue: string,
    meta?: { userAgent?: string; ip?: string },
  ) {
    if (!refreshTokenValue || refreshTokenValue.length < 32) {
      throw new BadRequestException('refresh_token مفقود أو قصير جدًا');
    }
    const tokenHash = hashToken(refreshTokenValue);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException('refresh_token غير صالح');
    }

    if (existing.revokedAt) {
      // SEC-F04: إعادة استخدام token ملغى = مؤشر سرقة. نُلغي كل سلسلة الاستبدال.
      // (نقوم بتحديث الـ token الملغى فعلاً — لا أثر، لكن نُسجّل محاولة في الـ logs).
      throw new UnauthorizedException(
        'refresh_token ملغى — قد تكون مسروقة. سجّل دخولك من جديد.',
      );
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('انتهت صلاحية refresh_token');
    }

    if (!existing.user.isActive) {
      throw new UnauthorizedException('هذا الحساب تم إيقافه');
    }

    // إصدار زوج جديد + ربط قديم → جديد
    const newRefreshToken = await this.issueRefreshToken(
      existing.user.id,
      meta,
    );

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        // ربط الـ token القديم بالجديد (الأخير يحمل replacedById)
      },
    });

    // ربط عكسي: الجديد يحفظ replacedById للقديم
    const newHash = hashToken(newRefreshToken);
    const newRow = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: newHash },
    });
    if (newRow) {
      await this.prisma.refreshToken.update({
        where: { id: newRow.id },
        data: { replacedById: existing.id },
      });
    }

    const accessToken = this.jwtService.sign({
      sub: existing.user.id,
      email: existing.user.email,
      role: existing.user.role,
      v: existing.user.jwtVersion,
    });

    const { password, ...userResult } = existing.user;

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      user: userResult,
    };
  }

  /**
   * SEC-F04: تسجيل الخروج — يلغي refresh_token واحدًا.
   * - لا يبطل الـ access token الحالي مباشرة (عمره قصير JWT_EXPIRES_IN)؛
   *   لكن نزيّد user.jwtVersion فتبطل كل الـ access tokens الصادرة قبل هذا التحديث.
   * - لو الـ token غير موجود أو ملغى أصلاً، نرجع 200 (idempotent).
   */
  async logout(refreshTokenValue: string) {
    if (!refreshTokenValue) {
      // حتى لو لم يُمرر، نزيد jwtVersion لإبطال الجلسة الحالية
      return { revoked: false, reason: 'no_token' };
    }
    const tokenHash = hashToken(refreshTokenValue);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!existing) {
      return { revoked: false, reason: 'not_found' };
    }

    if (existing.revokedAt) {
      return { revoked: true, reason: 'already_revoked' };
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      // زيادة jwtVersion يبطل كل الـ access tokens الصادرة قبل الـ logout.
      // JwtStrategy.validate يرفض payload.v !== user.jwtVersion.
      this.prisma.user.update({
        where: { id: existing.userId },
        data: { jwtVersion: { increment: 1 } },
      }),
    ]);

    return { revoked: true, reason: 'revoked' };
  }

  /**
   * SEC-F04: إصدار refresh_token خام جديد، تخزين hash، وإرجاع القيمة الأصلية
   * للعميل مرة واحدة فقط.
   */
  private async issueRefreshToken(
    userId: string,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<string> {
    const raw = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(
      Date.now() +
        (Number.isFinite(REFRESH_TOKEN_TTL_DAYS)
          ? REFRESH_TOKEN_TTL_DAYS
          : 30) *
          24 *
          60 *
          60 *
          1000,
    );

    try {
      await this.prisma.refreshToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt,
          userAgent: meta?.userAgent?.slice(0, 255),
          ipAddress: meta?.ip?.slice(0, 45),
        },
      });
    } catch {
      // P2002 (hash collision) — احتمال ضئيل لكن آمن إعادة المحاولة.
      return this.issueRefreshToken(userId, meta);
    }

    return raw;
  }
}

/** SEC-F04: sha256 hex hash — لا نخزّن النص الأصلي أبدًا. */
function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
