/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { Prisma } from '@prisma/client';

/** SEC-F04: sha256 helper متطابق مع الذراعي في auth.service.ts */
function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// AUTH-7: compare يُحاكى جزئيًا (التنفيذ الحقيقي يبقى الافتراضي) كي يمكن
// التخفي على استدعاءاته والتحقق منها دون كسر التجزئة الحقيقية في بقية
// الملف — bcrypt.compare على تجزئة كلفة 10 يكلف ~100ms لكل استدعاء.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    compare: jest.fn((plain: string, hash: string) =>
      actual.compare(plain, hash),
    ),
  };
});

/** وصول آمن نوعيًا إلى compare المُحاكى (الافتراضي = التنفيذ الحقيقي) */
const compareMock = (): jest.Mock => bcrypt.compare as unknown as jest.Mock;

/** مستخدم أساسي مشترك بين كل المجموعات */
const baseUser = {
  id: 'u-1',
  name: 'المدير العام',
  email: 'admin@factory.com',
  phone: '01000000000',
  role: 'SUPER_ADMIN' as const,
  isActive: true,
  jwtVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService — سلوك تسجيل الدخول (GF-0003 + SEC-F04)', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: { sign: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };
    (prisma.refreshToken as { create: jest.Mock }).create.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    });
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue(null);
    (prisma.refreshToken as { update: jest.Mock }).update.mockResolvedValue({});
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );
  });

  it('يعيد access_token + refresh_token + مستخدمًا بلا كلمة المرور عند صحة البيانات', async () => {
    const user = { ...baseUser, password: await bcrypt.hash('Pass@123', 4) };
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await service.login({
      email: 'admin@factory.com',
      password: 'Pass@123',
    });

    expect(result.access_token).toBe('signed-jwt-token');
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'u-1',
      email: 'admin@factory.com',
      role: 'SUPER_ADMIN',
      v: 0,
    });
    expect(result.user).not.toHaveProperty('password');
    expect(result.user.email).toBe('admin@factory.com');
    expect(typeof result.refresh_token).toBe('string');
    expect(result.refresh_token.length).toBeGreaterThanOrEqual(32);
  });

  it('يرفض بريدًا غير موجود بـ 401', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'ghost@factory.com', password: 'Pass@123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('يرفض كلمة مرور خاطئة بـ 401 حتى لو المستخدم موجود', async () => {
    const user = { ...baseUser, password: await bcrypt.hash('Correct@123', 4) };
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(
      service.login({ email: 'admin@factory.com', password: 'Wrong@123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('يرفض مستخدمًا موقوفًا (isActive=false) بـ 401 حتى لو كلمة المرور صحيحة', async () => {
    const user = {
      ...baseUser,
      isActive: false,
      password: await bcrypt.hash('Pass@123', 4),
    };
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(
      service.login({ email: 'admin@factory.com', password: 'Pass@123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('يبحث عن المستخدم بالبريد فقط (لا يقبل id أو غيره)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'x@factory.com', password: 'Pass@123' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'x@factory.com' },
    });
  });

  // ---------- AUTH-7: تسوية القناة الزمنية ----------

  it('AUTH-7: عند غياب المستخدم ينفّذ bcrypt.compare ضد تجزئة وهمية بكلفة 10 قبل الرفض', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    // نتجاوز التنفيذ الحقيقي لاستدعاء واحد كي لا ندفع كلفة bcrypt الفعلية
    // (~100ms) — المطلوب إثبات الاستدعاء نفسه لا نتيجته
    const compareSpy = compareMock();
    compareSpy.mockClear();
    compareSpy.mockImplementationOnce(() => Promise.resolve(false));

    await expect(
      service.login({ email: 'ghost@factory.com', password: 'Pass@123' }),
    ).rejects.toThrow(UnauthorizedException);

    // استُدعي مرة واحدة بذات كلفة تجزئة كلمات المرور ($2b$10$)
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith(
      'Pass@123',
      expect.stringMatching(/^\$2[aby]\$10\$/),
    );
  });

  it('AUTH-7: رفض غياب المستخدم يرجع نفس رسالة 401 الموحدة (لا كشف وجود البريد)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const compareSpy = compareMock();
    compareSpy.mockClear();
    compareSpy.mockImplementationOnce(() => Promise.resolve(false));

    await expect(
      service.login({ email: 'ghost@factory.com', password: 'Pass@123' }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    });
  });

  it('AUTH-7: المقارنة الوهمية لا تُستخدم في المسار الطبيعي (موجود + كلمة صحيحة)', async () => {
    const user = { ...baseUser, password: await bcrypt.hash('Pass@123', 4) };
    prisma.user.findUnique.mockResolvedValue(user);
    const compareSpy = compareMock();
    compareSpy.mockClear();
    compareSpy.mockImplementationOnce(() => Promise.resolve(true));

    const result = await service.login({
      email: 'admin@factory.com',
      password: 'Pass@123',
    });

    expect(result.access_token).toBe('signed-jwt-token');
    // مقارنة واحدة فقط ضد تجزئة المستخدم الحقيقي — لا مقارنة وهمية إضافية
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith('Pass@123', user.password);
  });
});

describe('AuthService — SEC-F04 refresh rotation + revoke', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: { sign: jest.Mock };

  // helper: إصدار refresh_token خام من service.login
  async function issueRefreshViaLogin() {
    const realHash = await bcrypt.hash('Pass@123', 4);
    const user = {
      id: 'u-1',
      name: 'مدير',
      email: 'admin@factory.com',
      phone: '01000000000',
      role: 'SUPER_ADMIN' as const,
      isActive: true,
      jwtVersion: 0,
      password: realHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.user.findUnique.mockResolvedValue(user);
    const result = await service.login({
      email: 'admin@factory.com',
      password: 'Pass@123',
    });
    return result.refresh_token;
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('access-token') };
    (prisma.refreshToken as { create: jest.Mock }).create.mockImplementation(
      ({ data }: { data: { tokenHash: string; userId: string } }) =>
        Promise.resolve({
          id: 'rt-' + data.tokenHash.slice(0, 8),
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: new Date(Date.now() + 30 * 86400_000),
        }),
    );
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue(null);
    (prisma.refreshToken as { update: jest.Mock }).update.mockResolvedValue({});
    // AUTH-2: refresh ينفذ داخل معاملة تفاعلية واحدة — الـ mock يشغّل
    // callback المعاملة بتمرير prisma نفسها كعميل tx (النمط القائم في specs
    // الشراء). logout يستخدم صيغة المصفوفة فندعم الشكلين معًا.
    (prisma as { $transaction: jest.Mock }).$transaction.mockImplementation(
      (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => Promise<unknown>)(prisma);
        }
        return Promise.resolve(arg ?? []);
      },
    );
    // AUTH-2: التحديث الشرطي الذري ينجح افتراضيًا (صف متأثر واحد)
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.user.update.mockResolvedValue({ jwtVersion: 1 });
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );
  });

  it('يرفض refresh token غير موجود بـ 401', async () => {
    await expect(service.refresh('a'.repeat(96))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('يرفض refresh token قصير جدًا (<32) بـ BadRequest', async () => {
    await expect(service.refresh('short')).rejects.toThrow(BadRequestException);
  });

  it('يرفض إعادة استخدام token ملغى بـ 401 (executeRaw يعيد 0 صفوف — مؤشر سرقة)', async () => {
    const raw = await issueRefreshViaLogin();
    const expectedHash = hashToken(raw);
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-1',
      tokenHash: expectedHash,
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: new Date(), // ملغى مسبقًا
      user: {
        id: 'u-1',
        email: 'admin@factory.com',
        role: 'SUPER_ADMIN',
        isActive: true,
        jwtVersion: 0,
        password: 'x',
        name: 'مدير',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    // AUTH-2: الشرط الذري (revoked_at IS NULL) لا يطابق صفًا ملغى مسبقًا
    prisma.$executeRaw.mockResolvedValue(0);
    await expect(service.refresh(raw)).rejects.toThrow(UnauthorizedException);
    // AUTH-3: استدعاءان لـ $executeRaw — الأول دوران AUTH-2 الفاشل، والثاني
    // إبطال عائلة السلسلة (يعمل ضمن معاملة المتابعة القصيرة)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('AUTH-2: يرفض سباق استخدام متزامن لنفس التوكن (executeRaw يعيد 0) بـ 401', async () => {
    const raw = await issueRefreshViaLogin();
    const expectedHash = hashToken(raw);
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue({
      id: 'rt-race',
      userId: 'u-1',
      tokenHash: expectedHash,
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null, // عند القراءة بدا غير ملغى — لكن طلبًا موازيًا سبق فألغاه
      user: {
        id: 'u-1',
        email: 'admin@factory.com',
        role: 'SUPER_ADMIN',
        isActive: true,
        jwtVersion: 0,
        password: 'x',
        name: 'مدير',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    prisma.$executeRaw.mockResolvedValue(0);
    // نصفّي عدّاد sign لأن issueRefreshViaLogin وقّع access توكن الدخول
    jwtService.sign.mockClear();
    await expect(service.refresh(raw)).rejects.toThrow(UnauthorizedException);
    // الخاسر في السباق لا يحصل على access token جديد رغم صلاحية القراءة الأولى
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('يرفض token منتهي الصلاحية بـ 401', async () => {
    const raw = await issueRefreshViaLogin();
    const expectedHash = hashToken(raw);
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-1',
      tokenHash: expectedHash,
      expiresAt: new Date(Date.now() - 1000), // منتهي
      revokedAt: null,
      user: {
        id: 'u-1',
        email: 'admin@factory.com',
        role: 'SUPER_ADMIN',
        isActive: true,
        jwtVersion: 0,
        password: 'x',
        name: 'مدير',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await expect(service.refresh(raw)).rejects.toThrow(UnauthorizedException);
    // فحص الانتهاء يسبق أي كتابة — لا يصل للتحديث الذري أصلًا
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('يدور token صالح: يصدر access+refresh جديد ويلغي القديم', async () => {
    const raw = await issueRefreshViaLogin();
    const expectedHash = hashToken(raw);
    // create للـ token الجديد: يُستدعى داخل issueRefreshToken؛ نُرجع row وهمي
    const createdTokens: { tokenHash: string; id: string }[] = [];
    (prisma.refreshToken as { create: jest.Mock }).create.mockImplementation(
      ({ data }: { data: { tokenHash: string; userId: string } }) => {
        const row = {
          id: 'rt-new-' + createdTokens.length,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: new Date(Date.now() + 86400_000),
        };
        createdTokens.push(row);
        return Promise.resolve(row);
      },
    );
    // findUnique: يُستدعى على الـ token القديم فقط (AUTH-2: لا إعادة قراءة للجديد)
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockImplementation(
      ({ where }: { where: { tokenHash: string } }) => {
        if (where.tokenHash === expectedHash) {
          return Promise.resolve({
            id: 'rt-old',
            userId: 'u-1',
            tokenHash: expectedHash,
            expiresAt: new Date(Date.now() + 86400_000),
            revokedAt: null,
            user: {
              id: 'u-1',
              email: 'admin@factory.com',
              role: 'SUPER_ADMIN',
              isActive: true,
              jwtVersion: 5,
              password: 'x',
              name: 'مدير',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
        // الـ token الجديد بعد create
        const found = createdTokens.find(
          (t) => t.tokenHash === where.tokenHash,
        );
        return found ?? null;
      },
    );

    const result = await service.refresh(raw);
    expect(result.access_token).toBe('access-token');
    expect(typeof result.refresh_token).toBe('string');
    expect(result.refresh_token).not.toBe(raw);
    // jwtService.sign استُدعي مع v=5 (jwtVersion المستخدم)
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ v: 5, sub: 'u-1' }),
    );

    // AUTH-2: الدورة كاملة داخل معاملة تفاعلية واحدة
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // AUTH-2: التوكن الجديد يُنشأ داخل المعاملة مع replacedById مضبوطًا
    // منذ الإنشاء مباشرة (لا تحديث لاحق منفصل لربطه بالقديم)
    expect(
      (prisma.refreshToken as { create: jest.Mock }).create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u-1',
          replacedById: 'rt-old',
        }),
      }),
    );

    // AUTH-2: الإلغاء والربط في تحديث شرطي ذري واحد بشرط revoked_at IS NULL —
    // لا استدعاءات update منفصلة
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [sqlParts, newTokenId, oldTokenId] = prisma.$executeRaw.mock.calls[0];
    expect(String(sqlParts)).toContain('UPDATE refresh_tokens');
    expect(String(sqlParts)).toContain('revoked_at IS NULL');
    expect(String(sqlParts)).toContain('replaced_by_id');
    // المعاملات بالترتيب: [id-التوكن-الجديد, id-التوكن-القديم]
    expect(String(newTokenId)).toMatch(/^rt-new-/);
    expect(String(oldTokenId)).toBe('rt-old');
    expect(
      (prisma.refreshToken as { update: jest.Mock }).update,
    ).not.toHaveBeenCalled();
  });

  it('logout — يلغي token صالح ويرفع jwtVersion', async () => {
    const raw = await issueRefreshViaLogin();
    const expectedHash = hashToken(raw);
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue({
      id: 'rt-active',
      userId: 'u-1',
      tokenHash: expectedHash,
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    });

    const result = await service.logout(raw);
    expect(result.revoked).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({ jwtVersion: { increment: 1 } }),
      }),
    );
  });

  it('logout — idempotent لـ token ملغى أصلًا', async () => {
    const raw = await issueRefreshViaLogin();
    const expectedHash = hashToken(raw);
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue({
      id: 'rt-already',
      userId: 'u-1',
      tokenHash: expectedHash,
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: new Date(), // ملغى أصلًا
    });
    const result = await service.logout(raw);
    expect(result.revoked).toBe(true);
    expect(result.reason).toBe('already_revoked');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('logout — idempotent لـ token غير موجود', async () => {
    const result = await service.logout(
      'nonexistent-unknown-token-value-xxxxxxxxxxxx',
    );
    expect(result.revoked).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('AUTH-8: logout بلا توكن يرجع no_token دون رفع jwtVersion أو أي بحث/إبطال (السلوك الفعلي الموثّق)', async () => {
    const result = await service.logout('');
    expect(result).toEqual({ revoked: false, reason: 'no_token' });
    // لا رفع نسخة ولا لمس لجدول الرموز — التوكن الحالي يبقى حتى انتهاء عمره القصير
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(
      (prisma.refreshToken as { findUnique: jest.Mock }).findUnique,
    ).not.toHaveBeenCalled();
  });
});

describe('AuthService — AUTH-3: إبطال عائلة الجلسة عند إعادة استخدام رمز ملغى', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: { sign: jest.Mock };

  /** يضبط findUnique ليرجع رمزًا يبدو صالحًا عند القراءة، لكن التحديث الشرطي
   * سيرجع 0 صفوف (ملغى فعليًا — مصدر الحقيقة هو WHERE revoked_at IS NULL) */
  function mockReusedToken() {
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue({
      id: 'rt-reused',
      userId: 'u-1',
      tokenHash: 'whatever',
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
      user: {
        id: 'u-1',
        name: 'مدير',
        email: 'admin@factory.com',
        role: 'SUPER_ADMIN',
        isActive: true,
        jwtVersion: 0,
        password: 'x',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('access-token') };
    (prisma.refreshToken as { create: jest.Mock }).create.mockResolvedValue({
      id: 'rt-new-1',
      userId: 'u-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    });
    // معاملة تفاعلية: callback يُشغَّل بتمرير prisma نفسها كعميل tx
    (prisma as { $transaction: jest.Mock }).$transaction.mockImplementation(
      (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => Promise<unknown>)(prisma);
        }
        return Promise.resolve(arg ?? []);
      },
    );
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.user.update.mockResolvedValue({ jwtVersion: 1 });
    prisma.activityLog.create.mockResolvedValue(undefined);
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );
  });

  it('إعادة استخدام رمز ملغى → إبطال العائلة + رفع jwtVersion + سجل تدقيق + 401', async () => {
    mockReusedToken();
    // التحديث الشرطي: صفر صفوف = الرمز ملغى مسبقًا (إشارة سرقة)
    prisma.$executeRaw.mockResolvedValue(0);
    const meta = { ip: '9.9.9.9', userAgent: 'UA-Test' };

    await expect(service.refresh('a'.repeat(96), meta)).rejects.toThrow(
      UnauthorizedException,
    );

    // استدعاءان لـ $executeRaw: دوران AUTH-2 (فشل) ثم إبطال العائلة
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const [familySql, familyHeadId] = prisma.$executeRaw.mock.calls[1];
    expect(String(familySql)).toContain('WITH RECURSIVE');
    expect(String(familySql)).toContain('replaced_by_id');
    // رأس السلسلة هو الرمز الملغى المُعاد استخدامه نفسه
    expect(String(familyHeadId)).toBe('rt-reused');

    // رفع jwtVersion يبطل كل access tokens الصادرة للمستخدم
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { jwtVersion: { increment: 1 } },
    });

    // سجل التدقيق الأمني — ip في ipAddress و userAgent في details
    // (نموذج ActivityLog لا يملك عمود userAgent — موثق في الخدمة)
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u-1',
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          module: 'AUTH',
          ipAddress: '9.9.9.9',
          details: expect.objectContaining({
            refreshTokenId: 'rt-reused',
            userAgent: 'UA-Test',
          }),
        }),
      }),
    );
  });

  it('فشل إبطال العائلة (عطل قاعدة) لا يحجب 401 الأمني — best-effort', async () => {
    mockReusedToken();
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.activityLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.refresh('a'.repeat(96))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('دوران سليم لا يطلق إبطال العائلة ولا السجل ولا رفع jwtVersion', async () => {
    mockReusedToken();
    prisma.$executeRaw.mockResolvedValue(1);
    await service.refresh('a'.repeat(96));
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });
});

describe('AuthService — AUTH-4: قفل محاولات الدخول الفاشلة + سجل التدقيق', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: { sign: jest.Mock };
  let validUser: typeof baseUser & { password: string };
  let nowMs: number;
  let dateNowSpy: jest.SpyInstance;

  const EMAIL = 'admin@factory.com';
  const baseTime = 1_750_000_000_000;

  beforeEach(async () => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };
    validUser = { ...baseUser, password: await bcrypt.hash('Pass@123', 4) };
    prisma.user.findUnique.mockResolvedValue(validUser);
    (prisma.refreshToken as { create: jest.Mock }).create.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    });
    prisma.activityLog.create.mockResolvedValue(undefined);
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );
    nowMs = baseTime;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('بعد 5 محاولات فاشلة خلال 15 دقيقة → القفل يعيد 429 حتى بكلمة المرور الصحيحة', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        service.login({ email: EMAIL, password: 'Wrong@123' }),
      ).rejects.toThrow(UnauthorizedException);
      nowMs += 60_000; // محاولات متباعدة دقيقة — كلها داخل نافذة الـ 15 دقيقة
    }
    const error = await service
      .login({ email: EMAIL, password: 'Pass@123' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toContain(
      'محاولات الدخول الفاشلة',
    );
    // فحص القفل يسبق أي وصول للقاعدة — المحاولة السادسة لم تبحث عن المستخدم
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(5);
  });

  it('النجاح يصفّر العداد — 4 إخفاقات ثم نجاح ثم 4 إخفاقات لا تقفل', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(
        service.login({ email: EMAIL, password: 'Wrong@123' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    await service.login({ email: EMAIL, password: 'Pass@123' });
    for (let i = 0; i < 4; i++) {
      await expect(
        service.login({ email: EMAIL, password: 'Wrong@123' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    const result = await service.login({ email: EMAIL, password: 'Pass@123' });
    expect(result.access_token).toBe('signed-jwt-token');
  });

  it('انتهاء مدة القفل (15 دقيقة) يفتح الدخول من جديد', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        service.login({ email: EMAIL, password: 'Wrong@123' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    nowMs += 16 * 60_000; // القفل المؤقت 15 دقيقة انقضى
    const result = await service.login({ email: EMAIL, password: 'Pass@123' });
    expect(result.access_token).toBe('signed-jwt-token');
  });

  it('انقضاء نافذة الـ 15 دقيقة يبدأ عدًّا جديدًا (المحاولات القديمة لا تتراكم)', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(
        service.login({ email: EMAIL, password: 'Wrong@123' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    nowMs += 16 * 60_000; // النافذة انقضت قبل المحاولة الخامسة
    await expect(
      service.login({ email: EMAIL, password: 'Wrong@123' }),
    ).rejects.toThrow(UnauthorizedException);
    // المحاولة التالية بكلمة صحيحة غير مقفلة — العداد 1 في نافذة جديدة
    const result = await service.login({ email: EMAIL, password: 'Pass@123' });
    expect(result.access_token).toBe('signed-jwt-token');
  });

  it('القفل مفاتيحه البريد — إخفاقات بريدٍ لا تقفل بريدًا آخر', async () => {
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { email: string } }) =>
        where.email === EMAIL
          ? Promise.resolve(validUser)
          : Promise.resolve(null),
    );
    for (let i = 0; i < 5; i++) {
      await expect(
        service.login({ email: EMAIL, password: 'Wrong@123' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    // بريد آخر لم يتأثر بقفل البريد الأول — 401 (وليس 429)
    await expect(
      service.login({ email: 'ghost@factory.com', password: 'Wrong@123' }),
    ).rejects.toThrow(UnauthorizedException);
    const error = await service
      .login({ email: 'ghost@factory.com', password: 'Wrong@123' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
  });

  it('يكتب LOGIN_FAILED عند كلمة مرور خاطئة (بريد + IP — بلا كلمة مرور أبدًا)', async () => {
    await expect(
      service.login(
        { email: EMAIL, password: 'Wrong@123' },
        { ip: '8.8.8.8', userAgent: 'UA-Login' },
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.activityLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u-1',
          action: 'LOGIN_FAILED',
          module: 'AUTH',
          ipAddress: '8.8.8.8',
          details: expect.objectContaining({
            email: EMAIL,
            reason: 'bad_password',
          }),
        }),
      }),
    );
    // أمان: لا كلمة مرور في أي مكان داخل حِمل السجل
    const recordedPayload = JSON.stringify(
      prisma.activityLog.create.mock.calls,
    );
    expect(recordedPayload).not.toContain('Wrong@123');
  });

  it('يكتب LOGIN_FAILED لمستخدم موقوف (reason=inactive)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...validUser, isActive: false });
    await expect(
      service.login({ email: EMAIL, password: 'Pass@123' }, { ip: '8.8.8.8' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'LOGIN_FAILED',
          details: expect.objectContaining({ reason: 'inactive' }),
        }),
      }),
    );
  });

  it('يكتب LOGIN_SUCCEEDED عند الدخول الناجح', async () => {
    await service.login(
      { email: EMAIL, password: 'Pass@123' },
      { ip: '7.7.7.7' },
    );
    expect(prisma.activityLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u-1',
          action: 'LOGIN_SUCCEEDED',
          module: 'AUTH',
          ipAddress: '7.7.7.7',
          details: expect.objectContaining({ email: EMAIL }),
        }),
      }),
    );
    // أمان: لا كلمة مرور في أي مكان داخل حِمل السجل
    const recordedPayload = JSON.stringify(
      prisma.activityLog.create.mock.calls,
    );
    expect(recordedPayload).not.toContain('Pass@123');
  });

  it('بريد غير موجود: 401 بلا سجل تدقيق (userId إلزامي FK) لكن المحاولات تُعدّ للقفل', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      await expect(
        service.login({ email: 'ghost@factory.com', password: 'Pass@123' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    // لا صف ActivityLog — لا مستخدم تشير إليه FK userId (قيد النموذج، موثق)
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
    const error = await service
      .login({ email: 'ghost@factory.com', password: 'Pass@123' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });
});

describe('AuthService — AUTH-5: إعادة المحاولة عند P2002 فقط وبحد أقصى 3', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: { sign: jest.Mock };

  const LOGIN = { email: 'admin@factory.com', password: 'Pass@123' };

  beforeEach(async () => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };
    prisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      password: await bcrypt.hash('Pass@123', 4),
    });
    prisma.activityLog.create.mockResolvedValue(undefined);
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );
  });

  it('خطأ غير P2002 يُعاد رميه فورًا بلا إعادة محاولة', async () => {
    const boom = new Error('connection reset');
    (prisma.refreshToken as { create: jest.Mock }).create.mockRejectedValue(
      boom,
    );
    await expect(service.login(LOGIN)).rejects.toThrow('connection reset');
    expect(
      (prisma.refreshToken as { create: jest.Mock }).create,
    ).toHaveBeenCalledTimes(1);
  });

  it('P2002 يُعاد توليد التوكن والمحاولة حتى النجاح', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`token_hash`)',
      { code: 'P2002', clientVersion: 'test' },
    );
    (prisma.refreshToken as { create: jest.Mock }).create
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce({
        id: 'rt-2',
        userId: 'u-1',
        tokenHash: 'h2',
        expiresAt: new Date(),
      });
    const result = await service.login(LOGIN);
    expect(result.refresh_token.length).toBeGreaterThanOrEqual(32);
    expect(
      (prisma.refreshToken as { create: jest.Mock }).create,
    ).toHaveBeenCalledTimes(2);
    // المحاولة الثانية بتوكن خام جديد (hash مختلف — أُعيد توليده)
    const createCalls = (prisma.refreshToken as { create: jest.Mock }).create
      .mock.calls as unknown as Array<Array<{ data: { tokenHash: string } }>>;
    expect(createCalls[1][0].data.tokenHash).not.toBe(
      createCalls[0][0].data.tokenHash,
    );
  });

  it('P2002 المستمر يتوقف بعد 3 محاولات ويُرمى الخطأ كما هو', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`token_hash`)',
      { code: 'P2002', clientVersion: 'test' },
    );
    (prisma.refreshToken as { create: jest.Mock }).create.mockRejectedValue(
      collision,
    );
    await expect(service.login(LOGIN)).rejects.toBe(collision);
    expect(
      (prisma.refreshToken as { create: jest.Mock }).create,
    ).toHaveBeenCalledTimes(3);
  });
});
