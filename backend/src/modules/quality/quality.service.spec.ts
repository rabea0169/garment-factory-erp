import { QualityService } from './quality.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkOrderStatus, RejectionReason } from '@prisma/client';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('QualityService — فحوصات الجودة (GF-0003)', () => {
  let service: QualityService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new QualityService(prisma as unknown as PrismaService);
  });

  it('يجلب الفحوصات مع أمر التشغيل والمنتج مرتبة بأحدث فحص', async () => {
    const checks = [
      { id: 'qc-1', checkedQty: 100, passedQty: 95, rejectedQty: 5 },
    ];
    prisma.qualityCheck.findMany.mockResolvedValue(checks);

    const result = await service.getQualityChecks();

    expect(result).toEqual(checks);
    expect(prisma.qualityCheck.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { checkedAt: 'desc' },
        include: {
          workOrder: {
            include: {
              variant: { include: { product: true } },
              bomVersion: true,
            },
          },
        },
      }),
    );
  });

  it('يسجل فحصًا بكمياته وأسباب الرفض كما وردت', async () => {
    const data = {
      workOrderId: 'wo-1',
      stage: WorkOrderStatus.SEWING,
      checkedQty: 100,
      passedQty: 92,
      rejectedQty: 8,
      rejectionReason: RejectionReason.SEWING_DEFECT,
      notes: 'عيوب خياطة في الأكمام',
    };
    prisma.qualityCheck.create.mockResolvedValue({ id: 'qc-2', ...data });

    const result = await service.addQualityCheck(data);

    expect(result.id).toBe('qc-2');
    expect(prisma.qualityCheck.create).toHaveBeenCalledWith({ data });
  });

  it('لا يسجل فحصًا إلا عبر create — لا مسار تعديل مباشر موجود', async () => {
    prisma.qualityCheck.create.mockResolvedValue({ id: 'qc-3' });
    await service.addQualityCheck({
      workOrderId: 'wo-1',
      stage: 'CUTTING',
      checkedQty: 50,
      passedQty: 50,
      rejectedQty: 0,
    });
    expect(prisma.qualityCheck.create).toHaveBeenCalledTimes(1);
  });
});
