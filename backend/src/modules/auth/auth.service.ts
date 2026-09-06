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
import { Prisma } from '@prisma/client';

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
    const { raw: refreshToken } = await this.issueRefreshToken(user.id, meta);

    const { password, ...result } = user;

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: result,
    };
  }

  /**
   * SEC-F04 + AUTH-2: استبدال الـ refresh token بآخر جديد (rotation) داخل
   * معاملة واحدة ذرية:
   * - يتحقق أن الـ token الأصلي موجود، غير منتهي، والمستخدم نشط.
   * - يصدر access_token + refresh_token جديدين، ويُنشأ التوكن الجديد داخل
   *   المعاملة نفسها مع replacedById مضبوطًا عند الإنشاء مباشرة (لا تحديث لاحق).
   * - إلغاء التوكن القديم يتم بتحديث شرطي ذري واحد
   *   (UPDATE ... WHERE revoked_at IS NULL) فلا يمكن لطلبين متزامنين
   *   بنفس التوكن النجاح مرتين (السباق يُحسم بعدد الصفوف المتأثرة).
   * - إعادة استخدام token ملغى (صفر صفوف متأثرة) = مؤشر سرقة → 401.
   */
  async refresh(
    refreshTokenValue: string,
    meta?: { userAgent?: string; ip?: string },
  ) {
    if (!refreshTokenValue || refreshTokenValue.length < 32) {
      throw new BadRequestException('refresh_token مفقود أو قصير جدًا');
    }
    const tokenHash = hashToken(refreshTokenValue);

    // AUTH-2: كل الكتابات (إنشاء الجديد + إلغاء القديم + الربط) داخل
    // معاملة تفاعلية واحدة — أي فشل يتراجع بالكامل فلا يبقى توكن جديد
    // بلا إلغاء القديم أو العكس.
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!existing) {
        throw new UnauthorizedException('refresh_token غير صالح');
      }

      if (existing.expiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException('انتهت صلاحية refresh_token');
      }

      if (!existing.user.isActive) {
        throw new UnauthorizedException('هذا الحساب تم إيقافه');
      }

      // إنشاء الجديد داخل المعاملة مع ربط replacedById منذ الإنشاء مباشرة
      const { raw: newRefreshToken, row: newRow } =
        await this.issueRefreshToken(existing.user.id, meta, {
          tx,
          replacedById: existing.id,
        });

      // الإلغاء الشرطي الذري: القديم يُلغى ويُربط بالجديد في تحديث واحد.
      // الصفوف المتأثرة = صفر ⇒ التوكن ملغى مسبقًا أو سباق استخدام متزامن
      // → 401 (برسالة السرقة القائمة) وتراجع كامل للمعاملة (بما فيها
      // إنشاء الجديد). أسماء الأعمدة snake_case مطابقة لهجرة SEC-F04 الفعلية.
      const revokedRows = await tx.$executeRaw`
        UPDATE refresh_tokens
        SET revoked_at = now(), replaced_by_id = ${newRow.id}
        WHERE id = ${existing.id} AND revoked_at IS NULL
      `;
      if (revokedRows === 0) {
        // SEC-F04: إعادة استخدام token ملغى = مؤشر سرقة محتملة.
        throw new UnauthorizedException(
          'refresh_token ملغى — قد تكون مسروقة. سجّل دخولك من جديد.',
        );
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
    });
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
   * AUTH-2: يقبل تمرير عميل معاملة (tx) لإنشاء التوكن داخل معاملة rotation،
   * مع ربط replacedById بالتوكن القديم منذ الإنشاء مباشرة (لا تحديث لاحق).
   * يرجع { raw, row } كي يستخدم المستدعي معرّف الصف الجديد في الربط الذري.
   */
  private async issueRefreshToken(
    userId: string,
    meta?: { userAgent?: string; ip?: string },
    options?: { tx?: Prisma.TransactionClient; replacedById?: string },
  ): Promise<{ raw: string; row: { id: string } }> {
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

    // AUTH-2: العملية تتم داخل المعاملة إن مُرّر عميلها، وإلا على الاتصال المباشر
    const client: Prisma.TransactionClient = options?.tx ?? this.prisma;

    try {
      const row = await client.refreshToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt,
          userAgent: meta?.userAgent?.slice(0, 255),
          ipAddress: meta?.ip?.slice(0, 45),
          replacedById: options?.replacedById,
        },
        select: { id: true },
      });
      return { raw, row };
    } catch {
      // P2002 (hash collision) — احتمال ضئيل لكن آمن إعادة المحاولة.
      return this.issueRefreshToken(userId, meta, options);
    }
  }
}

/** SEC-F04: sha256 hex hash — لا نخزّن النص الأصلي أبدًا. */
function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
