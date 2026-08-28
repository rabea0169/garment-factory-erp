/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

/** SEC-F04: sha256 helper متطابق مع الذراعي في auth.service.ts */
function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('AuthService — سلوك تسجيل الدخول (GF-0003 + SEC-F04)', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: { sign: jest.Mock };

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
    (prisma as { $transaction: jest.Mock }).$transaction.mockResolvedValue([]);
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

  it('يرفض token ملغى بـ 401 (مؤشر سرقة)', async () => {
    const raw = await issueRefreshViaLogin();
    const expectedHash = hashToken(raw);
    (
      prisma.refreshToken as { findUnique: jest.Mock }
    ).findUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-1',
      tokenHash: expectedHash,
      expiresAt: new Date(Date.now() + 86400_000),
      revokedAt: new Date(), // ملغى
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
    // findUnique: يُستدعى مرتين — أولًا على الـ token القديم، ثم على الجديد
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
    // الـ token القديم يُلغى
    expect(
      (prisma.refreshToken as { update: jest.Mock }).update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rt-old' }),
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
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
});
