import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { PrismaService } from '../../prisma/prisma.service';
import { SuppliersService } from './suppliers.service';
import { computeRequestHash } from '../../core/common/idempotency.util';

describe('SuppliersService — supplier master data', () => {
  let service: SuppliersService;
  let prisma: ReturnType<typeof createPrismaMock>;
  /** PUR-7: supplier.updateMany غير موجودة في prisma-mock المشترك — توسعة محلية (نمط W1-C/W2-2b). */
  let supplierUpdateMany: jest.Mock;

  beforeEach(() => {
    prisma = createPrismaMock();
    // RES-F02: $transaction must invoke the callback with the prisma mock
    // so the inner tx.supplier.create / tx.idempotencyKey calls resolve.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    supplierUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.supplier as unknown as { updateMany: jest.Mock }).updateMany =
      supplierUpdateMany;
    service = new SuppliersService(prisma as unknown as PrismaService);
  });

  it('lists only active, non-deleted suppliers with pagination', async () => {
    prisma.supplier.findMany.mockResolvedValue([]);
    prisma.supplier.count.mockResolvedValue(0);

    const result = await service.getSuppliers({ page: 2, limit: 10 });

    expect(result.data).toEqual([]);
    expect(prisma.supplier.findMany).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.supplier.count).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
    });
  });

  // PUR-7 (ج): includeInactive يضم المعطّلين إداريًا؛ المحذوفون ناعمًا
  // مستثنون دائمًا — والافتراضي (شاشات الاختيار) هو النشطون فقط.
  it('PUR-7 (ج): includeInactive=true يضم غير النشطين (deletedAt فقط في where)', async () => {
    prisma.supplier.findMany.mockResolvedValue([]);
    prisma.supplier.count.mockResolvedValue(0);

    await service.getSuppliers({ includeInactive: true });

    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    expect(prisma.supplier.count).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
  });

  it('PUR-7 (ج) + CC-6: q يبحث في name/code/phone وfrom/to على createdAt', async () => {
    prisma.supplier.findMany.mockResolvedValue([]);
    prisma.supplier.count.mockResolvedValue(0);

    await service.getSuppliers({
      q: 'نسيج',
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T23:59:59Z',
    });

    const findManyCalls = prisma.supplier.findMany.mock
      .calls as unknown as Array<[{ where: Record<string, unknown> }]>;
    const call = findManyCalls[0][0];
    expect(call.where.OR).toEqual([
      { name: { contains: 'نسيج', mode: 'insensitive' } },
      { code: { contains: 'نسيج', mode: 'insensitive' } },
      { phone: { contains: 'نسيج', mode: 'insensitive' } },
    ]);
    expect(call.where.createdAt).toEqual({
      gte: new Date('2026-08-01T00:00:00Z'),
      lte: new Date('2026-08-31T23:59:59Z'),
    });
  });

  it('يرفض فترة معكوسة (from بعد to) بـ 400 قبل أي استعلام', async () => {
    await expect(
      service.getSuppliers({
        from: '2026-09-01T00:00:00Z',
        to: '2026-08-01T00:00:00Z',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
  });

  it('trims supplier fields and generates a supplier code', async () => {
    prisma.supplier.create.mockResolvedValue({ id: 'sup-1' });

    await service.createSupplier({
      name: '  شركة النسيج  ',
      phone: ' 01000000000 ',
      email: ' SALES@EXAMPLE.COM ',
      address: ' القاهرة ',
      notes: '  مورد أساسي ',
    });

    const calls = prisma.supplier.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createCall = calls[0]?.[0];
    expect(createCall).toBeDefined();
    if (!createCall) throw new Error('supplier.create was not called');

    expect(createCall.data.name).toBe('شركة النسيج');
    expect(createCall.data.phone).toBe('01000000000');
    expect(createCall.data.email).toBe('sales@example.com');
    expect(createCall.data.address).toBe('القاهرة');
    expect(createCall.data.notes).toBe('مورد أساسي');
    expect(createCall.data.code).toEqual(expect.stringMatching(/^SUP-/));
  });

  it('maps supplier unique conflicts to 409', async () => {
    prisma.supplier.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );

    await expect(
      service.createSupplier({ name: 'شركة مكررة' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // PUR-7 (أ) (P2 — GF-IMP-W3): تحديث بيانات مورد — PATCH دلالي + تدقيق
  // بالقيم قبل/بعد + idempotency.
  describe('PUR-7 (أ) — updateSupplier', () => {
    it('يحدّث الحقول المرسلة فقط (trim) ويكتب ActivityLog بالقيم قبل/بعد', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'SUP-1',
        name: 'شركة النسيج',
        phone: '01000000000',
        address: 'القاهرة',
        notes: null,
        deletedAt: null,
      });
      prisma.supplier.update.mockResolvedValue({
        id: 'sup-1',
        name: 'شركة النسيج المتحدة',
        phone: '01111111111',
      });

      const result = await service.updateSupplier(
        'sup-1',
        { name: '  شركة النسيج المتحدة  ', phone: ' 01111111111 ' },
        'actor-1',
      );

      expect(result).toMatchObject({ id: 'sup-1' });
      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        // الحقول غير المرسلة (address/notes) لا تُمس
        data: { name: 'شركة النسيج المتحدة', phone: '01111111111' },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'actor-1',
          action: 'SUPPLIER_UPDATED',
          module: 'PURCHASING',
          details: expect.objectContaining({
            supplierId: 'sup-1',
            code: 'SUP-1',
            changedFields: {
              name: { before: 'شركة النسيج', after: 'شركة النسيج المتحدة' },
              phone: { before: '01000000000', after: '01111111111' },
            },
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      });
    });

    it('طلب بلا أي حقل → 400 قبل أي كتابة', async () => {
      await expect(
        service.updateSupplier('sup-1', {}, 'actor-1'),
      ).rejects.toThrow('لا حقول للتحديث');
      expect(prisma.supplier.update).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('اسم مسافات فقط → 400 (لا تمرير اسم فارغ)', async () => {
      await expect(
        service.updateSupplier('sup-1', { name: '   ' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('مورد غير موجود → 404', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSupplier('sup-missing', { notes: 'x' }, 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('نفس المفتاح + نفس المحتوى يعيد replay بلا تحديث ثانٍ', async () => {
      const stored = { id: 'sup-1', name: 'الاسم الجديد' };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'update-key-replay',
        scope: 'supplier-update',
        requestHash: computeRequestHash({
          operation: 'supplier-update',
          supplierId: 'sup-1',
          actorId: 'actor-1',
          updates: { notes: 'ملاحظة' },
        }),
        response: stored,
      });

      const result = await service.updateSupplier(
        'sup-1',
        { notes: 'ملاحظة' },
        'actor-1',
        'update-key-replay',
      );

      expect(result).toEqual({ ...stored, replayed: true });
      expect(prisma.supplier.update).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });
  });

  // PUR-7 (ب): تعطيل/تنشيط — CAS + ActivityLog + idempotency (نمط users W2).
  describe('PUR-7 (ب) — deactivate/activate (CAS)', () => {
    it('يعطّل موردًا نشطًا: updateMany مشروط بـ isActive=true + تدقيق + تخزين الاستجابة', async () => {
      prisma.supplier.findUnique
        .mockResolvedValueOnce({
          id: 'sup-1',
          code: 'SUP-1',
          name: 'شركة النسيج',
          deletedAt: null,
        })
        .mockResolvedValue({ id: 'sup-1', isActive: false });
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });

      const result = await service.deactivateSupplier(
        'sup-1',
        'actor-1',
        'deactivate-key-1',
      );

      expect(supplierUpdateMany).toHaveBeenCalledWith({
        where: { id: 'sup-1', isActive: true, deletedAt: null },
        data: { isActive: false },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'actor-1',
          action: 'SUPPLIER_DEACTIVATED',
          module: 'PURCHASING',
          details: expect.objectContaining({
            supplierId: 'sup-1',
            isActive: false,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      });
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'deactivate-key-1' },
          data: { response: expect.anything() as unknown },
        }) as Record<string, unknown>,
      );
      expect(result).toMatchObject({ id: 'sup-1' });
    });

    it('ينشّئ موردًا معطّلًا: updateMany مشروط بـ isActive=false', async () => {
      prisma.supplier.findUnique
        .mockResolvedValueOnce({
          id: 'sup-1',
          code: 'SUP-1',
          name: 'شركة النسيج',
          deletedAt: null,
        })
        .mockResolvedValue({ id: 'sup-1', isActive: true });

      await service.activateSupplier('sup-1', 'actor-1');

      expect(supplierUpdateMany).toHaveBeenCalledWith({
        where: { id: 'sup-1', isActive: false, deletedAt: null },
        data: { isActive: true },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'SUPPLIER_ACTIVATED',
          details: expect.objectContaining({ isActive: true }) as Record<
            string,
            unknown
          >,
        }) as Record<string, unknown>,
      });
    });

    it('CAS صفر صفوف (معطّل مسبقًا) → 409 بلا تدقيق', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'SUP-1',
        name: 'شركة النسيج',
        deletedAt: null,
      });
      supplierUpdateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deactivateSupplier('sup-1', 'actor-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('مورد غير موجود أو محذوف ناعمًا → 404', async () => {
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'SUP-1',
        name: 'محذوف',
        deletedAt: new Date(),
      });

      await expect(
        service.activateSupplier('sup-1', 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(supplierUpdateMany).not.toHaveBeenCalled();
    });

    it('replay للتعطيل: نفس المفتاح يعيد الاستجابة بلا أثر ثانٍ', async () => {
      const stored = { id: 'sup-1', isActive: false };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'deactivate-key-replay',
        scope: 'supplier-deactivate',
        requestHash: computeRequestHash({
          operation: 'supplier-deactivate',
          supplierId: 'sup-1',
          actorId: 'actor-1',
        }),
        response: stored,
      });

      const result = await service.deactivateSupplier(
        'sup-1',
        'actor-1',
        'deactivate-key-replay',
      );

      expect(result).toEqual({ ...stored, replayed: true });
      expect(supplierUpdateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });
  });
});
