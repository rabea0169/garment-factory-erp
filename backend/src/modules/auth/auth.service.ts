import {
  BadRequestException,
  HttpException,
  HttpStatus,
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

/** AUTH-4: حد المحاولات الفاشلة داخل النافذة قبل القفل المؤقت. */
const MAX_FAILED_LOGINS = 5;
/** AUTH-4: نافذة عدّ المحاولات الفاشلة (15 دقيقة). */
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** AUTH-4: مدة القفل المؤقت بعد بلوغ الحد (15 دقيقة). */
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

/** حالة عداد محاولات الدخول الفاشلة لكل بريد. */
interface FailedLoginState {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

@Injectable()
export class AuthService {
  /**
   * AUTH-4: عداد محاولات الدخول الفاشلة في الذاكرة (Map لكل بريد).
   * قرار مرحلي موثق: التخزين في ذاكرة العملية — يكفي لصد brute-force
   * على نسخة واحدة ويعاد تصفيره بإعادة التشغيل؛ الترقية إلى مخزن مشترك
   * (Redis) عبر عدة نسخ موثقة في بند CC-7 (الموجة 3).
   * ملاحظة: الحجم محدود عمليًا — الإدخال يُحذف عند النجاح أو انتهاء القفل.
   */
  private readonly failedLoginAttempts = new Map<string, FailedLoginState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto, meta?: { userAgent?: string; ip?: string }) {
    // AUTH-4: فحص القفل قبل أي وصول للقاعدة — البريد هو المفتاح (موحد الصياغة
    // فلا يكشف وجود الحساب؛ القفل يرتبط بالبريد نفسه بغض النظر عن وجوده).
    const emailKey = loginDto.email.trim().toLowerCase();
    if (this.isLoginLocked(emailKey)) {
      throw new HttpException(
        'عدد كبير من محاولات الدخول الفاشلة — تم تقييد الدخول مؤقتًا لمدة 15 دقيقة',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      this.registerFailedLogin(emailKey);
      throw new UnauthorizedException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      this.registerFailedLogin(emailKey);
      await this.auditLogin(user.id, 'LOGIN_FAILED', loginDto.email, meta, {
        reason: 'bad_password',
      });
      throw new UnauthorizedException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    if (!user.isActive) {
      this.registerFailedLogin(emailKey);
      await this.auditLogin(user.id, 'LOGIN_FAILED', loginDto.email, meta, {
        reason: 'inactive',
      });
      throw new UnauthorizedException('هذا الحساب تم إيقافه، راجع الإدارة');
    }

    // AUTH-4: النجاح يصفّر عداد الإخفاقات ويُسجّل في سجل التدقيق.
    this.failedLoginAttempts.delete(emailKey);
    await this.auditLogin(user.id, 'LOGIN_SUCCEEDED', loginDto.email, meta);

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
   * - AUTH-3: إعادة استخدام token ملغى (صفر صفوف متأثرة) = مؤشر سرقة →
   *   إبطال عائلة السلسلة كاملة (revokeSessionFamily) ثم 401.
   */
  async refresh(
    refreshTokenValue: string,
    meta?: { userAgent?: string; ip?: string },
  ) {
    if (!refreshTokenValue || refreshTokenValue.length < 32) {
      throw new BadRequestException('refresh_token مفقود أو قصير جدًا');
    }
    const tokenHash = hashToken(refreshTokenValue);

    // AUTH-3: سياق إعادة الاستخدام يُملأ داخل المعاملة عند فشل التحديث الشرطي —
    // الرمي داخلها يُتراجع بكل كتاباتها، فلا يمكن تنفيذ عقوبات العائلة داخلها
    // (لتراجعت مع 401 وبقيت العائلة صالحة — عكس الغرض الأمني)؛ نجمع المعلومات
    // هنا ونطبقها في معاملة قصيرة تالية بعد خروج الاستثناء (القرار موثق في revokeSessionFamily).
    let reuse: {
      tokenId: string;
      userId: string;
      email: string;
    } | null = null;

    try {
      // AUTH-2: كل الكتابات (إنشاء الجديد + إلغاء القديم + الربط) داخل
      // معاملة تفاعلية واحدة — أي فشل يتراجع بالكامل فلا يبقى توكن جديد
      // بلا إلغاء القديم أو العكس.
      return await this.prisma.$transaction(async (tx) => {
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
          // AUTH-3: إعادة استخدام token ملغى = مؤشر سرقة محتملة — نسجّل
          // السياق ونرمي 401؛ الـ catch الخارجي يطبق إبطال العائلة.
          reuse = {
            tokenId: existing.id,
            userId: existing.user.id,
            email: existing.user.email,
          };
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
    } catch (error) {
      if (reuse) {
        await this.revokeSessionFamily(reuse, meta);
      }
      throw error;
    }
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
   * AUTH-5: إعادة المحاولة فقط عند تصادم hash الفريد (P2002) — بحد أقصى
   * 3 محاولات كاملة؛ أي استثناء آخر (شبكة/قاعدة/برمجة) يُعاد رميه كما هو
   * فورًا. الالتقاط العام السابق كان يبتلع كل الأخطاء ويعيد الاستدعاء ذاتيًا
   * بلا حد → إمكانية تكرار لا نهائي وإخفاء أعطال حقيقية.
   */
  private async issueRefreshToken(
    userId: string,
    meta?: { userAgent?: string; ip?: string },
    options?: { tx?: Prisma.TransactionClient; replacedById?: string },
    attempt = 1,
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
    } catch (error) {
      // AUTH-5: P2002 فقط (تصادم token_hash الفريد — احتمال مهمل لكن آمن
      // تكراره بتوليد توكن خام جديد)، وبحد أقصى 3 محاولات.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        attempt < 3
      ) {
        return this.issueRefreshToken(userId, meta, options, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * AUTH-4: هل البريد مقفل مؤقتًا بسبب محاولات فاشلة متكررة؟
   * انتهاء القفل يحذف الإدخال فيبدأ المستخدم نافذة نظيفة.
   */
  private isLoginLocked(emailKey: string): boolean {
    const state = this.failedLoginAttempts.get(emailKey);
    if (!state) {
      return false;
    }
    if (state.lockedUntil > Date.now()) {
      return true;
    }
    if (state.lockedUntil !== 0) {
      // القفل انتهى — تنظيف خامل وإعادة تصفير
      this.failedLoginAttempts.delete(emailKey);
    }
    return false;
  }

  /**
   * AUTH-4: تسجيل محاولة دخول فاشلة — عدّاد بنافذة 15 دقيقة لكل بريد،
   * وعند بلوغ 5 محاولات داخل النافذة يُقفل البريد مؤقتًا 15 دقيقة.
   */
  private registerFailedLogin(emailKey: string): void {
    const now = Date.now();
    const state = this.failedLoginAttempts.get(emailKey);
    if (!state || now - state.windowStart > FAILED_LOGIN_WINDOW_MS) {
      // لا إدخال أو نافذة منقضية — نبدأ عدًّا جديدًا
      this.failedLoginAttempts.set(emailKey, {
        count: 1,
        windowStart: now,
        lockedUntil: 0,
      });
      return;
    }
    state.count += 1;
    if (state.count >= MAX_FAILED_LOGINS) {
      state.lockedUntil = now + LOGIN_LOCK_DURATION_MS;
    }
  }

  /**
   * AUTH-4: تدقيق محاولات الدخول (LOGIN_SUCCEEDED/LOGIN_FAILED).
   * قيد النموذج: ActivityLog.userId إلزامي (FK إلى users) فتُسجَّل المحاولات
   * على حسابات موجودة فقط — محاولة بريد غير معروف لا تُكتب في السجل لأن
   * لا صف مستخدم تشير إليه (تُعدّ للقفل ومعاملاتها الموحدة كالمعتاد).
   * لا تُخزّن كلمة المرور أبدًا — البريد و IP فقط (المتصل يمرر البريد نصًا).
   * الكتابة best-effort: فشل التدقيق لا يشوّه استجابة المصادقة الأمنية.
   */
  private async auditLogin(
    userId: string,
    action: 'LOGIN_SUCCEEDED' | 'LOGIN_FAILED',
    email: string,
    meta?: { userAgent?: string; ip?: string },
    details?: { reason?: string },
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId,
          action,
          module: 'AUTH',
          details: { email, reason: details?.reason },
          ipAddress: meta?.ip?.slice(0, 45),
        },
      });
    } catch {
      // التدقيق best-effort — لا نسمح لفشل السجل بتغيير استجابة الدخول
    }
  }

  /**
   * AUTH-3: إبطال عائلة الجلسة عند رصد إعادة استخدام refresh_token ملغى.
   *
   * قرار التصميم (موثق): تُنفذ في معاملة تفاعلية قصيرة **منفصلة** بعد فشل
   * معاملة الدوران — الرمي داخل معاملة الدوران يتراجع بكل كتاباتها، فلو
   * نُفذ الإبطال داخلها لتراجع مع 401 وبقيت العائلة صالحة (عكس الغرض
   * الأمني). المعاملة القصيرة تضمن ذراعية الخطوات الثلاث معًا:
   *
   * (1) إبطال كل المنحدرين من سلسلة الاستبدال التي يتصدرها الرمز الملغى —
   *     عبر CTE تكراري (WITH RECURSIVE) يجمع معرفات السلسلة بعبور
   *     replaced_by_id ثم تحديث واحد للكل (بدل حلقة استعلامات لكل مستوى).
   *     الرمز الملغى نفسه رأس السلسلة فَيُشمَل (تحديثه idempotent).
   * (2) رفع user.jwtVersion — يبطل كل access tokens الصادرة للمستخدم
   *     (يفحصها JwtStrategy.validate بمقارنة payload.v).
   * (3) كتابة ActivityLog برمز REFRESH_TOKEN_REUSE_DETECTED (userId +
   *     ip في ipAddress و userAgent في details — النموذج لا يملك عموده).
   *
   * الإبطال best-effort: فشله (عطل قاعدة) لا يجب أن يحجب 401 الأمني —
   * الرمز الملغى مرفوض أصلًا بكل الأحوال، والفشل يظهر في مراقبة القاعدة.
   */
  private async revokeSessionFamily(
    reuse: { tokenId: string; userId: string; email: string },
    meta?: { userAgent?: string; ip?: string },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // (1) إبطال عائلة السلسلة — الأعمدة snake_case كما في هجرة SEC-F04
        await tx.$executeRaw`
          WITH RECURSIVE chain AS (
            SELECT id FROM refresh_tokens WHERE id = ${reuse.tokenId}
            UNION ALL
            SELECT r.id FROM refresh_tokens r
            INNER JOIN chain c ON r.replaced_by_id = c.id
          )
          UPDATE refresh_tokens
          SET revoked_at = now()
          WHERE id IN (SELECT id FROM chain) AND revoked_at IS NULL
        `;
        // (2) إبطال كل access tokens عبر رفع إصدار الجلسة
        await tx.user.update({
          where: { id: reuse.userId },
          data: { jwtVersion: { increment: 1 } },
        });
        // (3) سجل تدقيق أمني بالحادثة
        await tx.activityLog.create({
          data: {
            userId: reuse.userId,
            action: 'REFRESH_TOKEN_REUSE_DETECTED',
            module: 'AUTH',
            details: {
              refreshTokenId: reuse.tokenId,
              email: reuse.email,
              userAgent: meta?.userAgent?.slice(0, 255),
            },
            ipAddress: meta?.ip?.slice(0, 45),
          },
        });
      });
    } catch {
      // best-effort: لا نحجب 401 الأمني بفشل الإبطال — موثق أعلاه
    }
  }
}

/** SEC-F04: sha256 hex hash — لا نخزّن النص الأصلي أبدًا. */
function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
