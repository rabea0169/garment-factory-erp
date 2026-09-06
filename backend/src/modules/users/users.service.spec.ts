/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

// CC-9: bcrypt مُحاكى — الاختبارات سريعة، والتحقق على العتاد (10 rounds
// نفس prisma/seed.ts) يتم عبر toHaveBeenCalledWith لا بتنفيذ فعلي.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('bcrypt-hashed-password'),
}));

describe('UsersService — إدارة المستخدمين (CC-9 / GF-IMP-W2)', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof createPrismaMock>;
  // CC-9: user.create/findMany/count/updateMany غير موجودة في prisma-mock
  // المشترك (يوجد findUnique/update فقط) — توسعة محلية (نمط W1-C/W2-2b)
  // بدل تعديل مساعد مشترك بين وكلاء موازيين. المرجع الموسوع أدناه يجعل
  // الوصول الآمن نوعيًا في كل الاختبارات بلا casts متكررة.
  let userMock: {
    findUnique: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
  };

  const createUserDto = (
    overrides: Partial<CreateUserDto> = {},
  ): CreateUserDto => ({
    name: 'سارة أحمد',
    email: 'sara@factory.com',
    password: 'Pass@123',
    role: UserRole.INVENTORY_MANAGER,
    ...overrides,
  });

  const safeUser = {
    id: 'u-9',
    name: 'سارة أحمد',
    email: 'sara@factory.com',
    role: UserRole.INVENTORY_MANAGER,
    isActive: true,
    createdAt: new Date('2026-09-06T00:00:00Z'),
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    userMock = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    userMock.create = jest.fn().mockResolvedValue(safeUser);
    userMock.findMany = jest.fn().mockResolvedValue([safeUser]);
    userMock.count = jest.fn().mockResolvedValue(1);
    userMock.updateMany = jest.fn().mockResolvedValue({ count: 1 });

    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });

    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('createUser', () => {
    it('ينشئ مستخدمًا بهاش bcrypt (10 rounds مثل seed) وتدقيق داخل المعاملة', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.createUser(
        createUserDto(),
        'admin-1',
        'user-key-1',
      );

      expect(result).toEqual(safeUser);
      expect(bcrypt.hash).toHaveBeenCalledWith('Pass@123', 10);
      expect(userMock.create).toHaveBeenCalledWith({
        data: {
          name: 'سارة أحمد',
          email: 'sara@factory.com',
          password: 'bcrypt-hashed-password',
          role: UserRole.INVENTORY_MANAGER,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'USER_CREATED',
          module: 'USERS',
          details: expect.objectContaining({
            email: 'sara@factory.com',
            role: UserRole.INVENTORY_MANAGER,
          }),
        }),
      });
      // idempotency كامل النمط: إنشاء المفتاح داخل المعاملة ثم تخزين الاستجابة
      expect(prisma.idempotencyKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: 'user-key-1',
          scope: 'users-create',
        }),
        select: { id: true },
      });
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
        where: { key: 'user-key-1' },
        data: { response: safeUser },
      });
    });

    it('يرفض بريدًا مكررًا بـ 409 عربية قبل أي إنشاء', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-existing' });

      await expect(
        service.createUser(createUserDto(), 'admin-1'),
      ).rejects.toThrow('البريد الإلكتروني مستخدم بالفعل');
      expect(userMock.create).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('يلتقط P2002 على فهرس البريد (سباق) ويعيده 409 بنفس الرسالة', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      userMock.create = jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '7.9.1',
        }),
      );

      await expect(
        service.createUser(createUserDto(), 'admin-1'),
      ).rejects.toThrow('البريد الإلكتروني مستخدم بالفعل');
    });

    it('نفس المفتاح + نفس المحتوى يعيد replay بلا مستخدم ثانٍ', async () => {
      const dto = createUserDto();
      const stored = { ...safeUser, replayed: true };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'user-key-replay',
        scope: 'users-create',
        requestHash: computeRequestHash({
          operation: 'users-create',
          actorId: 'admin-1',
          name: dto.name,
          email: dto.email,
          role: dto.role,
        }),
        response: stored,
      });

      const result = await service.createUser(
        dto,
        'admin-1',
        'user-key-replay',
      );

      expect(result).toEqual(stored);
      expect(userMock.create).not.toHaveBeenCalled();
    });

    it('نفس المفتاح + محتوى مختلف → 409 (ConflictException)', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'user-key-conflict',
        scope: 'users-create',
        requestHash: computeRequestHash({
          operation: 'users-create',
          actorId: 'someone-else',
          name: 'مستخدم آخر',
          email: 'other@factory.com',
          role: UserRole.VIEWER,
        }),
        response: { id: 'u-other' },
      });

      await expect(
        service.createUser(createUserDto(), 'admin-1', 'user-key-conflict'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('changeUserRole', () => {
    it('يغيّر الدور بـ CAS على الدور السابق ويسجل قبل/بعد في التدقيق', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(safeUser)
        .mockResolvedValue({ ...safeUser, role: UserRole.ACCOUNTANT });
      userMock.updateMany = jest.fn().mockResolvedValue({ count: 1 });

      const result = await service.changeUserRole(
        'u-9',
        UserRole.ACCOUNTANT,
        'admin-1',
        'role-key-1',
      );

      expect(result).toMatchObject({
        id: 'u-9',
        role: UserRole.ACCOUNTANT,
      });
      expect(userMock.updateMany).toHaveBeenCalledWith({
        where: { id: 'u-9', role: UserRole.INVENTORY_MANAGER },
        data: { role: UserRole.ACCOUNTANT },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'USER_ROLE_CHANGED',
          module: 'USERS',
          details: expect.objectContaining({
            targetUserId: 'u-9',
            previousRole: UserRole.INVENTORY_MANAGER,
            newRole: UserRole.ACCOUNTANT,
          }),
        }),
      });
    });

    it('يرفض تغيير دور نفسك بـ 409 عربية قبل أي كتابة', async () => {
      await expect(
        service.changeUserRole('admin-1', UserRole.VIEWER, 'admin-1'),
      ).rejects.toThrow('لا يمكنك تغيير دورك الخاص');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('يرفض الدور نفسه الحالي بـ 409 (لا كتابة عبثية)', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);

      await expect(
        service.changeUserRole('u-9', UserRole.INVENTORY_MANAGER, 'admin-1'),
      ).rejects.toThrow('هو دور المستخدم الحالي بالفعل');
    });

    it('يرفض التزامن: updateMany صفر صفوف → 409 بلا تدقيق', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      userMock.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await expect(
        service.changeUserRole('u-9', UserRole.ACCOUNTANT, 'admin-1'),
      ).rejects.toThrow('بالتزامن');
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('404 لمستخدم غير موجود', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changeUserRole('missing', UserRole.VIEWER, 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deactivateUser / activateUser', () => {
    it('يعطّل مستخدمًا بـ CAS على isActive=true ويسجل التدقيق', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(safeUser)
        .mockResolvedValue({ ...safeUser, isActive: false });

      const result = await service.deactivateUser('u-9', 'admin-1', 'off-key');

      expect(result).toMatchObject({ id: 'u-9', isActive: false });
      expect(userMock.updateMany).toHaveBeenCalledWith({
        where: { id: 'u-9', isActive: true },
        data: { isActive: false },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'USER_DEACTIVATED',
          module: 'USERS',
          details: expect.objectContaining({ isActive: false }),
        }),
      });
    });

    it('يرفض تعطيل نفسك بـ 409 عربية', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...safeUser,
        id: 'admin-1',
      });

      await expect(
        service.deactivateUser('admin-1', 'admin-1'),
      ).rejects.toThrow('لا يمكنك تعطيل حسابك الخاص');
      expect(userMock.updateMany).not.toHaveBeenCalled();
    });

    it('يرفض تعطيل معطّل مسبقًا (صفر صفوف) بـ 409', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      userMock.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await expect(
        service.deactivateUser('u-9', 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('ينشّط مستخدمًا معطّلًا بـ CAS على isActive=false ويسجل التدقيق', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ ...safeUser, isActive: false })
        .mockResolvedValue({ ...safeUser, isActive: true });

      const result = await service.activateUser('u-9', 'admin-1', 'on-key');

      expect(result).toMatchObject({ id: 'u-9', isActive: true });
      expect(userMock.updateMany).toHaveBeenCalledWith({
        where: { id: 'u-9', isActive: false },
        data: { isActive: true },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'USER_ACTIVATED',
          module: 'USERS',
        }),
      });
    });

    it('نفس مفتاح التعطيل يعيد replay بلا كتابة ثانية', async () => {
      const stored = { id: 'u-9', isActive: false, replayed: true };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'off-key-replay',
        scope: 'users-deactivate',
        requestHash: computeRequestHash({
          operation: 'users-deactivate',
          targetUserId: 'u-9',
          actorId: 'admin-1',
        }),
        response: stored,
      });

      const result = await service.deactivateUser(
        'u-9',
        'admin-1',
        'off-key-replay',
      );

      expect(result).toEqual(stored);
      expect(userMock.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listUsers', () => {
    it('يرجع صفحة مرقّمة بselect آمن بلا أي عمود حساس', async () => {
      const result = await service.listUsers(new UserQueryDto());

      expect(result.data).toEqual([safeUser]);
      expect(result.meta.total).toBe(1);
      expect(userMock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('يطبّق فلتري role وisActive في الـ where', async () => {
      const query = new UserQueryDto();
      query.role = UserRole.VIEWER;
      query.isActive = false;

      await service.listUsers(query);

      expect(userMock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: UserRole.VIEWER, isActive: false },
        }),
      );
      expect(userMock.count).toHaveBeenCalledWith({
        where: { role: UserRole.VIEWER, isActive: false },
      });
    });
  });
});
