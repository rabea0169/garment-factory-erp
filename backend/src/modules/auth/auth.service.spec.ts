import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('AuthService — سلوك تسجيل الدخول (GF-0003)', () => {
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );
  });

  it('يعيد توكنًا ومستخدمًا بلا كلمة المرور عند صحة البيانات', async () => {
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
    });
    expect(result.user).not.toHaveProperty('password');
    expect(result.user.email).toBe('admin@factory.com');
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
