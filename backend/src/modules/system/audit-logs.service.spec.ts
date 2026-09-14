import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditLogsService } from './audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';

/**
 * SELIM-ERP W3 — اختبارات سجل التدقيق:
 * - قاعدة الرؤية: SUPER_ADMIN/GENERAL_MANAGER يريان الكل؛ البقية
 *   مدخلاتهم فقط (userId مفروض — طلب userId آخر مرفوض).
 * - التصفية (module/action/تاريخ) + الترقيم + إجمالي العدد.
 */

describe('AuditLogsService — سجل التدقيق (SELIM W3)', () => {
  let service: AuditLogsService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AuditLogsService(prisma as unknown as PrismaService);
    prisma.activityLog.findMany.mockResolvedValue([]);
    prisma.activityLog.count.mockResolvedValue(0);
  });

  it('SUPER_ADMIN يرى الكل بلا فرض userId', async () => {
    await service.query(new AuditLogsQueryDto(), {
      id: 'admin-1',
      role: UserRole.SUPER_ADMIN,
    });
    const where = (
      prisma.activityLog.findMany.mock.calls[0] as [
        { where?: Record<string, unknown> },
      ]
    )[0].where;
    expect(where?.userId).toBeUndefined();
  });

  it('الكاشير يرى مدخلاته فقط — userId مفروض عليه', async () => {
    await service.query(new AuditLogsQueryDto(), {
      id: 'cashier-1',
      role: UserRole.CASHIER,
    });
    const where = (
      prisma.activityLog.findMany.mock.calls[0] as [
        { where?: Record<string, unknown> },
      ]
    )[0].where;
    expect(where?.userId).toBe('cashier-1');
  });

  it('الكاشير يطلب userId آخر → Forbidden (منع تجاوز الرؤية)', async () => {
    const dto = new AuditLogsQueryDto();
    dto.userId = 'someone-else';
    await expect(
      service.query(dto, { id: 'cashier-1', role: UserRole.CASHIER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('تصفية module + action + نطاق تاريخ + ترقيم', async () => {
    const dto = new AuditLogsQueryDto();
    dto.module = 'SALES';
    dto.action = 'POS_SALE_COMPLETED';
    dto.startDate = '2026-09-01';
    dto.endDate = '2026-09-30';
    dto.page = 2;
    dto.pageSize = 25;

    prisma.activityLog.count.mockResolvedValue(60);
    prisma.activityLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        userId: 'u-1',
        action: 'POS_SALE_COMPLETED',
        module: 'SALES',
        details: { total: 100 },
        createdAt: new Date('2026-09-10'),
        user: { name: 'محمد' },
      },
    ]);

    const result = await service.query(dto, {
      id: 'admin-1',
      role: UserRole.SUPER_ADMIN,
    });

    const arg = (
      prisma.activityLog.findMany.mock.calls[0] as [Record<string, unknown>]
    )[0];
    expect(arg.where).toEqual({
      module: 'SALES',
      action: 'POS_SALE_COMPLETED',
      createdAt: {
        gte: new Date('2026-09-01'),
        lte: new Date('2026-09-30T23:59:59.999Z'),
      },
    });
    expect(arg.skip).toBe(25); // (page 2 - 1) * 25
    expect(arg.take).toBe(25);
    expect(result.total).toBe(60);
    expect(result.logs[0].userName).toBe('محمد');
  });

  it('endDate بلا وقت يُمدّد لنهاية اليوم (لتفادي حصر اليوم)', async () => {
    const dto = new AuditLogsQueryDto();
    dto.endDate = '2026-09-14';
    await service.query(dto, { id: 'admin-1', role: UserRole.SUPER_ADMIN });
    const where = (
      prisma.activityLog.findMany.mock.calls[0] as [
        { where?: { createdAt?: { lte?: Date } } },
      ]
    )[0].where;
    expect(where?.createdAt?.lte?.toISOString()).toBe(
      '2026-09-14T23:59:59.999Z',
    );
  });
});
