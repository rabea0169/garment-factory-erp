import 'reflect-metadata';
import { UserRole, WorkerSpecialty } from '@prisma/client';
import { DataImportService } from './data-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { computeRequestHash } from '../../core/common/idempotency.util';

/**
 * SELIM-ERP W2 — اختبارات معالج الاستيراد:
 * - تحليل CSV (فاصلة/فاصلة منقوطة/اقتباس) ورؤوس عربية/إنجليزية.
 * - التحقق: مطلوب/رقم/هاتف/enum بتخصص عربي + تكرار داخل الملف ومع القاعدة.
 * - الأدوار: رفض دور لا يملك إنشاء الكيان.
 * - التنفيذ: إنشاء الصفوف الصالحة فقط + idempotency.
 */

type ImportPrismaMock = ReturnType<typeof createPrismaMock> & {
  product: ReturnType<typeof createPrismaMock>['product'] & {
    create: jest.Mock;
  };
  customer: ReturnType<typeof createPrismaMock>['customer'] & {
    create: jest.Mock;
  };
  supplier: ReturnType<typeof createPrismaMock>['supplier'] & {
    create: jest.Mock;
  };
  worker: ReturnType<typeof createPrismaMock>['worker'] & {
    create: jest.Mock;
  };
};

function createImportMock(): ImportPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    product: { ...base.product, create: jest.fn() },
    customer: { ...base.customer, create: jest.fn() },
    supplier: {
      ...(base.supplier ?? {}),
      create: jest.fn(),
    },
    worker: { ...base.worker, create: jest.fn() },
  };
}

/** CSV عربي بأعمدة المنتجات: الاسم/السعر مطلوبان. */
function productsCsv(rows: string[]): Buffer {
  return Buffer.from(
    ['الاسم,سعر القطاعي,الكود,الباركود', ...rows].join('\n'),
    'utf8',
  );
}

describe('DataImportService — معالج الاستيراد (SELIM W2)', () => {
  let service: DataImportService;
  let prisma: ImportPrismaMock;
  const tx = {} as unknown as ImportPrismaMock;

  beforeEach(() => {
    prisma = createImportMock();
    prisma.$transaction.mockImplementation(
      (arg: (client: ImportPrismaMock) => Promise<unknown>): Promise<unknown> =>
        arg(tx),
    );
    Object.assign(tx, prisma);
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.create.mockResolvedValue({ id: 'p-1', code: 'PROD-X' });
    prisma.worker.findMany.mockResolvedValue([]);
    prisma.worker.create.mockResolvedValue({ id: 'w-1', code: 'WKR-1' });
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.create.mockResolvedValue({ id: 'c-1', code: 'CUST-1' });
    (
      prisma.supplier as unknown as { findMany: jest.Mock; create: jest.Mock }
    ).findMany?.mockResolvedValue([]);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    service = new DataImportService(prisma as unknown as PrismaService);
  });

  it('معاينة CSV: يفصل الصفوف الصالحة عن الفاسدة برسائل عربية', async () => {
    const csv = productsCsv([
      'تيشيرت أحمر,250,P1,111',
      'قميص,-10,P2,', // سعر سالب
      ',300,P3,', // اسم مفقود
    ]);
    const result = await service.preview(
      csv,
      'products.csv',
      'products',
      UserRole.GENERAL_MANAGER,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(2);
    expect(result.rows[1].errors[0].message).toContain('رقمًا غير سالب');
    expect(result.rows[2].errors[0].message).toContain('الاسم مطلوب');
  });

  it('كشف الفاصلة المنقوطة والمرادفات الإنجليزية للرؤوس', async () => {
    const csv = Buffer.from('name;retailPrice\nتيشيرت;120\n', 'utf8');
    const result = await service.preview(
      csv,
      'products.csv',
      'products',
      UserRole.GENERAL_MANAGER,
    );
    expect(result.rows[0].data).toMatchObject({
      name: 'تيشيرت',
      retailPrice: '120',
    });
    expect(result.validCount).toBe(1);
  });

  it('التكرار داخل الملف يعلّم الصف الثاني فقط', async () => {
    const csv = productsCsv(['تيشيرت,250,P1,111', 'نسخة أخرى,250,P1,']);
    const result = await service.preview(
      csv,
      'products.csv',
      'products',
      UserRole.GENERAL_MANAGER,
    );
    expect(result.validCount).toBe(1);
    expect(result.rows[1].errors[0].message).toContain('مكرر داخل الملف');
  });

  it('التكرار مع القاعدة يعلّم الصف (bulk query)', async () => {
    prisma.product.findMany.mockResolvedValue([{ code: 'P1', barcode: null }]);
    const csv = productsCsv(['تيشيرت,250,P1,']);
    const result = await service.preview(
      csv,
      'products.csv',
      'products',
      UserRole.GENERAL_MANAGER,
    );
    expect(result.validCount).toBe(0);
    expect(result.rows[0].errors[0].message).toContain('موجود مسبقًا');
  });

  it('يرفض الدور بلا صلاحية على الكيان (استيراد عمال بدور كاشير)', async () => {
    await expect(
      service.preview(
        Buffer.from('الاسم,التخصص\nأحمد,خياطة\n', 'utf8'),
        'workers.csv',
        'workers',
        UserRole.CASHIER,
      ),
    ).rejects.toThrow('لا يملك صلاحية');
  });

  it('العمال: تخصص عربي يُحل إلى enum القياسي', async () => {
    const csv = Buffer.from(
      'الاسم,التخصص,أجر القطعة\nأحمد,خياطة,5.5\n',
      'utf8',
    );
    const result = await service.preview(
      csv,
      'workers.csv',
      'workers',
      UserRole.HR_MANAGER,
    );
    expect(result.validCount).toBe(1);

    await service.commit(
      'workers',
      [{ name: 'أحمد', specialty: 'خياطة', pieceRate: '5.5' }],
      'user-1',
      UserRole.HR_MANAGER,
    );
    expect(prisma.worker.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'أحمد',
          specialty: WorkerSpecialty.SEWING,
          pieceRate: 5.5,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('التنفيذ: الصفوف الصالحة تُنشأ والفاسدة تُتخطى بتقرير', async () => {
    const result = (await service.commit(
      'products',
      [
        { name: 'صالح', retailPrice: '100' },
        { name: '', retailPrice: '50' },
        { retailPrice: '60' },
      ],
      'user-1',
      UserRole.GENERAL_MANAGER,
      'key-1',
    )) as { created: number; skipped: number };
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
    // توليد الكود عند غيابه.
    const createData = (
      prisma.product.create.mock.calls as unknown as Array<
        [{ data: { code?: string } }]
      >
    )[0][0].data;
    expect(createData.code).toMatch(/^PROD-/);
    // سجل تدقيق الاستيراد.
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DATA_IMPORT_COMPLETED',
          module: 'IMPORT',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('idempotency: مفتاح مكتمل الاستجابة يعيد النتيجة بلا إنشاء', async () => {
    const rows = [{ name: 'أي', retailPrice: '1' }];
    const requestHash = computeRequestHash({
      operation: 'data-import',
      userId: 'user-1',
      entityType: 'products',
      rows,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      scope: 'data-import',
      requestHash,
      response: { created: 3, skipped: 0, replayed: true },
    });
    const result = (await service.commit(
      'products',
      rows,
      'user-1',
      UserRole.GENERAL_MANAGER,
      'key-done',
    )) as { created?: number; replayed?: boolean };
    expect(result.replayed).toBe(true);
    expect(result.created).toBe(3);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('describeEntities: أربعة كيانات بأدوار وأعمدة موصوفة', () => {
    const entities = service.describeEntities();
    expect(entities.map((e) => e.type)).toEqual([
      'products',
      'customers',
      'suppliers',
      'workers',
    ]);
    expect(entities[0].columns.find((c) => c.key === 'name')?.required).toBe(
      true,
    );
  });
});
