import 'reflect-metadata';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController — تجميع إحصائيات لوحة التحكم (MOBILE-F03/F04)', () => {
  let controller: DashboardController;
  // نُجمِّع نوع الاستجابة من service كـ "غير معلّن" عمدًا لأن النمط المتعارف عليه
  // في بقية specs هو service كـ jest.Mock plain-object. أي شيء نُعيّنه هنا
  // كافٍ للاختبار دون فرض قيود منع-any القاسية على البنية الديناميكية.
  // eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const fakeStats: {
    today: { date: string; salesTotal: number; productionPieces: number };
    inventory: {
      totalMaterials: number;
      lowStockMaterials: number;
      totalFinishedGoodsTypes: number;
      inventoryValue: number;
    };
    pendingWorkOrders: number;
    treasuryBalance: number;
    recentTransactions: never[];
    sales: number[];
    production: number[];
    topWorkers: never[];
  } = {
    today: {
      date: '2026-08-30T00:00:00.000Z',
      salesTotal: 0,
      productionPieces: 0,
    },
    inventory: {
      totalMaterials: 0,
      lowStockMaterials: 0,
      totalFinishedGoodsTypes: 0,
      inventoryValue: 0,
    },
    pendingWorkOrders: 0,
    treasuryBalance: 0,
    recentTransactions: [],
    sales: [0, 0, 0, 0, 0, 0],
    production: [0, 0, 0, 0, 0, 0],
    topWorkers: [],
  };

  let service: { getStats: jest.Mock };

  beforeEach(() => {
    service = { getStats: jest.fn().mockResolvedValue(fakeStats) };
    controller = new DashboardController(
      service as unknown as DashboardService,
    );
  });

  it('يوفّر مسار GET /dashboard/stats يُفوّض إلى service.getStats', async () => {
    const result = await controller.getStats();
    expect(service.getStats).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeStats);
  });
});
