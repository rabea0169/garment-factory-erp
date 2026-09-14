/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NotFoundException } from '@nestjs/common';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { BranchesService } from './branches.service';

/**
 * SELIM-ERP W4: اختبارات فروع الشركة — نقل CompanyBranch من المرجع
 * (SPRINT 89/93/94) بقواعده: رئيسي واحد فقط، لا حذف للفرع الرئيسي،
 * تدقيق ActivityLog لكل كتابة.
 */
describe('BranchesService — فروع الشركة (SELIM-ERP W4)', () => {
  let service: BranchesService;
  let prisma: ReturnType<typeof createPrismaMock>;

  const actorId = 'actor-0001';

  beforeEach(() => {
    prisma = createPrismaMock();
    // المعاملة تُمرَّر نفس الـ mock (نمط باقي الوحدات).
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.companyBranch.findMany.mockResolvedValue([]);
    prisma.companyBranch.findUnique.mockResolvedValue(null);
    prisma.companyBranch.create.mockImplementation(
      jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'branch-001', ...data }),
        ),
    );
    prisma.companyBranch.update.mockImplementation(
      jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'branch-001', name: 'x', ...data }),
        ),
    );
    service = new BranchesService(prisma as never);
  });

  describe('list', () => {
    it('يعيد الفروع مرتبة مع عدادات المستندات المرتبطة', async () => {
      prisma.companyBranch.findMany.mockResolvedValue([
        {
          id: 'b1',
          name: 'الفرع الرئيسي',
          address: null,
          phone: null,
          manager: null,
          isMain: true,
          isActive: true,
          createdAt: new Date('2026-09-14T00:00:00Z'),
          _count: { salesOrders: 5, purchaseOrders: 2, products: 9 },
        },
      ]);
      const result = await service.list();
      expect(result.branches).toHaveLength(1);
      expect(result.branches[0]).toMatchObject({
        id: 'b1',
        salesCount: 5,
        purchaseCount: 2,
        productsCount: 9,
      });
      expect(prisma.companyBranch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
        }),
      );
    });
  });

  describe('create', () => {
    it('ينشئ فرعًا عاديًا بلا مس رئيسية الآخرين', async () => {
      const created = await service.create(
        { name: 'فرع القاهرة', address: ' شارع التحرير ', phone: undefined },
        actorId,
      );
      expect(created).toMatchObject({ name: 'فرع القاهرة' });
      expect(prisma.companyBranch.updateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'BRANCH_CREATED' }),
      });
    });

    it('تعيين isMain يلغي رئيسية كل الفروع الأخرى داخل المعاملة', async () => {
      await service.create({ name: 'فرع الجيزة', isMain: true }, actorId);
      expect(prisma.companyBranch.updateMany).toHaveBeenCalledWith({
        where: { isMain: true },
        data: { isMain: false },
      });
    });

    it('يقصّ النصوص ويخزّن null للفراغات (نفس trim في المرجع)', async () => {
      const created = await service.create(
        { name: 'فرع الإسكندرية', address: '   ', phone: ' 0100 ' },
        actorId,
      );
      expect(created).toMatchObject({ address: null, phone: '0100' });
    });
  });

  describe('update', () => {
    it('يرمي 404 للفرع غير الموجود', async () => {
      await expect(
        service.update('missing', { name: 'x' }, actorId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('نقل الرئيسية يلغي رئيسية غيره فقط (id: not)', async () => {
      prisma.companyBranch.findUnique.mockResolvedValue({
        id: 'b1',
        name: 'فرع',
        isMain: false,
      });
      await service.update('b1', { isMain: true }, actorId);
      expect(prisma.companyBranch.updateMany).toHaveBeenCalledWith({
        where: { isMain: true, id: { not: 'b1' } },
        data: { isMain: false },
      });
    });

    it('null في حقول نصية يمسحها (patch جزئي كالمرجع)', async () => {
      prisma.companyBranch.findUnique.mockResolvedValue({
        id: 'b1',
        name: 'فرع',
        isMain: false,
      });
      await service.update('b1', { manager: null }, actorId);
      expect(prisma.companyBranch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ manager: null }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('يرمي 404 للفرع غير الموجود', async () => {
      await expect(service.remove('missing', actorId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('يرفض حذف الفرع الرئيسي بلا حذف (نفس 400 في المرجع)', async () => {
      prisma.companyBranch.findUnique.mockResolvedValue({
        id: 'b1',
        name: 'الرئيسي',
        isMain: true,
      });
      const result = (await service.remove('b1', actorId)) as {
        success: boolean;
        error: string;
      };
      expect(result.success).toBe(false);
      expect(result.error).toContain('الفرع الرئيسي');
      expect(prisma.companyBranch.delete).not.toHaveBeenCalled();
    });

    it('يحذف فرعًا غير رئيسي ويدوّن ذلك في سجل التدقيق', async () => {
      prisma.companyBranch.findUnique.mockResolvedValue({
        id: 'b2',
        name: 'فرع ثانوي',
        isMain: false,
      });
      const result = await service.remove('b2', actorId);
      expect(result).toEqual({ success: true });
      expect(prisma.companyBranch.delete).toHaveBeenCalledWith({
        where: { id: 'b2' },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'BRANCH_DELETED' }),
      });
    });
  });
});
