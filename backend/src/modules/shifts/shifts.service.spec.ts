import 'reflect-metadata';
import { ShiftStatus, UserRole } from '@prisma/client';
import { ShiftsService } from './shifts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import type { PrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * SELIM-ERP W1 — اختبارات خدمة الورديات.
 *
 * تركّز على قواعد رقابة الدرج (نفس قواعد Selim ERP):
 * - لا وردية مفتوحة ثانية لنفس المستخدم.
 * - الإغلاق لصاحب الوردية أو للمدير العام فقط.
 * - المتوقع والفرق يُحسبان على الخادم من مبيعات الوردية النقدية.
 * - الوردية مستند رقابة لا قيدًا محاسبيًا — لا journal البتة.
 */

/** إدخال وسيط لقراءة بيانات إنشاء الوردية (بلا any مسرب — نمط sales spec). */
interface ShiftSessionCreateCall {
  data: {
    code: string;
    openedByName: string;
    status: ShiftStatus;
    startCash: number;
  };
}

/** مرشحات تجميع مبيعات الوردية النقدية (userId/paymentType/createdAt). */
interface SalesOrderAggregateCall {
  where: {
    userId: string;
    paymentType: string;
    createdAt: { gte: Date };
  };
}

/** إدخال وسيط لقراءة بيانات إغلاق الوردية (updateMany الشرطي). */
interface ShiftSessionUpdateManyCall {
  where: { id: string; status: ShiftStatus };
  data: {
    expectedCash: number;
    difference: number;
    endCash: number;
    status: ShiftStatus;
  };
}

/** مرشحات البحث عن الوردية المفتوحة الحالية. */
interface ShiftSessionFindFirstCall {
  where: { openedById: string; status: ShiftStatus };
}

/**
 * SELIM-W1: امتداد محلي للـ mock الموحد — حساب المتوقع يحتاج
 * salesOrder.aggregate لمبيعات الوردية النقدية (نمط SalesPrismaMock:
 * لا نغيّر شكل نماذج قائمة في الـ helper المشترك).
 */
type ShiftsPrismaMock = PrismaMock & {
  salesOrder: PrismaMock['salesOrder'] & { aggregate: jest.Mock };
};

function createShiftsPrismaMock(): ShiftsPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    salesOrder: { ...base.salesOrder, aggregate: jest.fn() },
  };
}

describe('ShiftsService — قواعد الورديات (SELIM W1)', () => {
  let service: ShiftsService;
  let prisma: ShiftsPrismaMock;
  let nextNumber: jest.Mock;
  // tx يشترك مع prisma في نفس الـ mocks (المعاملة تمر على نفس الوكيل).
  const tx = {} as unknown as ShiftsPrismaMock;

  beforeEach(() => {
    prisma = createShiftsPrismaMock();
    prisma.$transaction.mockImplementation(
      (
        arg: ((client: ShiftsPrismaMock) => Promise<unknown>) | unknown[],
      ): Promise<unknown> =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
    );
    prisma.shiftSession.findFirst.mockResolvedValue(null);
    prisma.shiftSession.findUnique.mockResolvedValue(null);
    prisma.shiftSession.findMany.mockResolvedValue([]);
    prisma.shiftSession.count.mockResolvedValue(0);
    prisma.shiftSession.create.mockResolvedValue({
      id: 'shf-1',
      code: 'SHF-0001',
    });
    prisma.shiftSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'كاشير الرئيسي',
    });
    prisma.salesOrder.aggregate.mockResolvedValue({
      _sum: { paidAmount: null },
    });
    Object.assign(tx, prisma);
    nextNumber = jest.fn().mockResolvedValue('SHF-0001');
    const sequence = { nextNumber } as unknown as SequenceService;
    service = new ShiftsService(prisma as unknown as PrismaService, sequence);
  });

  it('يرفض فتح وردية ثانية للمستخدم نفسه', async () => {
    prisma.shiftSession.findFirst.mockResolvedValue({
      id: 'shf-open',
      code: 'SHF-0001',
    });
    await expect(service.open({ startCash: 0 }, 'user-1')).rejects.toThrow(
      'توجد وردية مفتوحة بالفعل لهذا المستخدم',
    );
  });

  it('يفتح الوردية بترقيم SHF ولقطة اسم الفاتح', async () => {
    await service.open({ startCash: 100, notes: 'صباحية' }, 'user-1');
    expect(nextNumber).toHaveBeenCalledWith('SHIFT_SESSION', tx);
    const createCall = (
      prisma.shiftSession.create.mock.calls as unknown as Array<
        [ShiftSessionCreateCall]
      >
    )[0][0];
    expect(createCall.data.code).toBe('SHF-0001');
    expect(createCall.data.openedByName).toBe('كاشير الرئيسي');
    expect(createCall.data.status).toBe(ShiftStatus.OPEN);
    expect(Number(createCall.data.startCash)).toBe(100);
  });

  it('يرفض إغلاق وردية مستخدم آخر من كاشير', async () => {
    prisma.shiftSession.findUnique.mockResolvedValue({
      id: 'shf-1',
      status: ShiftStatus.OPEN,
      openedById: 'user-other',
      startTime: new Date('2026-09-01T08:00:00Z'),
      startCash: 0,
      notes: null,
    });
    await expect(
      service.close(
        'shf-1',
        { endCash: 0 },
        { id: 'user-1', role: UserRole.CASHIER },
      ),
    ).rejects.toThrow('لا يمكن إغلاق وردية مستخدم آخر');
  });

  it('يرفض إغلاق وردية غير مفتوحة', async () => {
    prisma.shiftSession.findUnique.mockResolvedValue({
      id: 'shf-1',
      status: ShiftStatus.CLOSED,
      openedById: 'user-1',
    });
    await expect(
      service.close('shf-1', { endCash: 0 }, { id: 'user-1' }),
    ).rejects.toThrow('الوردية مغلقة بالفعل');
  });

  it('يحسب المتوقع = الافتتاحي + المبيعات النقدية والفرق على الخادم', async () => {
    prisma.shiftSession.findUnique.mockResolvedValue({
      id: 'shf-1',
      status: ShiftStatus.OPEN,
      openedById: 'user-1',
      startTime: new Date('2026-09-01T08:00:00Z'),
      startCash: 100,
      notes: null,
    });
    prisma.salesOrder.aggregate.mockResolvedValue({
      _sum: { paidAmount: 500 },
    });
    await service.close(
      'shf-1',
      { endCash: 650, notes: 'فرق مردود' },
      { id: 'user-1', role: UserRole.CASHIER },
    );
    // التجميع على مبيعات صاحب الوردية النقدية منذ بدء الوردية فقط.
    const where = (
      prisma.salesOrder.aggregate.mock.calls as unknown as Array<
        [SalesOrderAggregateCall]
      >
    )[0][0].where;
    expect(where.userId).toBe('user-1');
    expect(where.paymentType).toBe('CASH');
    expect(where.createdAt.gte).toEqual(new Date('2026-09-01T08:00:00Z'));
    const updateCall = (
      prisma.shiftSession.updateMany.mock.calls as unknown as Array<
        [ShiftSessionUpdateManyCall]
      >
    )[0][0];
    expect(updateCall.where).toEqual({ id: 'shf-1', status: ShiftStatus.OPEN });
    // متوقع = 100 + 500 = 600؛ فرق = 650 − 600 = 50.
    expect(Number(updateCall.data.expectedCash)).toBe(600);
    expect(Number(updateCall.data.difference)).toBe(50);
    expect(Number(updateCall.data.endCash)).toBe(650);
    expect(updateCall.data.status).toBe(ShiftStatus.CLOSED);
  });

  it('يتوقع رصيد الافتتاح وحده حين لا مبيعات نقدية', async () => {
    prisma.shiftSession.findUnique.mockResolvedValue({
      id: 'shf-1',
      status: ShiftStatus.OPEN,
      openedById: 'user-1',
      startTime: new Date('2026-09-01T08:00:00Z'),
      startCash: 250,
      notes: null,
    });
    prisma.salesOrder.aggregate.mockResolvedValue({
      _sum: { paidAmount: null },
    });
    await service.close('shf-1', { endCash: 250 }, { id: 'user-1' });
    const updateCall = (
      prisma.shiftSession.updateMany.mock.calls as unknown as Array<
        [ShiftSessionUpdateManyCall]
      >
    )[0][0];
    expect(Number(updateCall.data.expectedCash)).toBe(250);
    expect(Number(updateCall.data.difference)).toBe(0);
  });

  it('يسمح للمدير العام بإغلاق وردية كاشير آخر (إغلاق إشرافي)', async () => {
    prisma.shiftSession.findUnique.mockResolvedValue({
      id: 'shf-1',
      status: ShiftStatus.OPEN,
      openedById: 'user-cashier',
      startTime: new Date('2026-09-01T08:00:00Z'),
      startCash: 0,
      notes: null,
    });
    await service.close(
      'shf-1',
      { endCash: 0 },
      { id: 'user-gm', role: UserRole.GENERAL_MANAGER },
    );
    expect(prisma.shiftSession.updateMany).toHaveBeenCalled();
  });

  it('يرفض الإغلاق المتزامن المزدوج (شرط الحالة داخل التحديث)', async () => {
    prisma.shiftSession.findUnique.mockResolvedValue({
      id: 'shf-1',
      status: ShiftStatus.OPEN,
      openedById: 'user-1',
      startTime: new Date('2026-09-01T08:00:00Z'),
      startCash: 0,
      notes: null,
    });
    prisma.shiftSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.close('shf-1', { endCash: 0 }, { id: 'user-1' }),
    ).rejects.toThrow('تغيرت بالتزامن');
  });

  it('يعيد الوردية المفتوحة الحالية أو null', async () => {
    prisma.shiftSession.findFirst.mockResolvedValue(null);
    await expect(service.getCurrent('user-1')).resolves.toBeNull();
    const open = { id: 'shf-open', status: ShiftStatus.OPEN };
    prisma.shiftSession.findFirst.mockResolvedValue(open);
    await expect(service.getCurrent('user-1')).resolves.toEqual(open);
    const where = (
      prisma.shiftSession.findFirst.mock.calls as unknown as Array<
        [ShiftSessionFindFirstCall]
      >
    )[1][0].where;
    expect(where.openedById).toBe('user-1');
    expect(where.status).toBe(ShiftStatus.OPEN);
  });
});
