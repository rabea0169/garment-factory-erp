import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('InventoryController — التفويض وتمرير العمليات (GF-0003/GF-0007)', () => {
  let controller: InventoryController;
  let service: {
    getAllRawMaterials: jest.Mock;
    getLowStockMaterials: jest.Mock;
    addRawMaterialStock: jest.Mock;
    getAllFinishedGoods: jest.Mock;
    getDashboardSummary: jest.Mock;
    getWarehouses: jest.Mock;
    getLedgerEntries: jest.Mock;
    receive: jest.Mock;
    issue: jest.Mock;
    adjust: jest.Mock;
    waste: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getAllRawMaterials: jest.fn().mockResolvedValue([]),
      getLowStockMaterials: jest.fn().mockResolvedValue([]),
      addRawMaterialStock: jest.fn().mockResolvedValue({ id: 'rm-1' }),
      getAllFinishedGoods: jest.fn().mockResolvedValue([]),
      getDashboardSummary: jest.fn().mockResolvedValue({}),
      getWarehouses: jest.fn().mockResolvedValue([]),
      getLedgerEntries: jest.fn().mockResolvedValue([]),
      receive: jest.fn().mockResolvedValue({ replayed: false }),
      issue: jest.fn().mockResolvedValue({ replayed: false }),
      adjust: jest.fn().mockResolvedValue({ replayed: false }),
      waste: jest.fn().mockResolvedValue({ replayed: false }),
    };
    controller = new InventoryController(
      service as unknown as InventoryService,
    );
  });

  it('يفوّض قراءات المخزون إلى الخدمة', async () => {
    await controller.getRawMaterials();
    await controller.getLowStockMaterials();
    await controller.getFinishedGoods();
    await controller.getSummary();
    expect(service.getAllRawMaterials).toHaveBeenCalledTimes(1);
    expect(service.getLowStockMaterials).toHaveBeenCalledTimes(1);
    expect(service.getAllFinishedGoods).toHaveBeenCalledTimes(1);
    expect(service.getDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('إضافة الرصيد (مسار قديم) تمرر (id, quantity, costPerUnit, userId) بالترتيب', async () => {
    const body = { quantity: 50, costPerUnit: 45.5 };
    await controller.addStock('rm-1', body, 'user-1');
    expect(service.addRawMaterialStock).toHaveBeenCalledWith(
      'rm-1',
      50,
      45.5,
      'user-1',
    );
  });

  // ============ GF-0007: المخازن / الـ ledger / الحركات ============

  it('قائمة المخازن وسجل الحركات يُفوَّضان للخدمة مع المرشحات', async () => {
    const filters = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      type: 'RECEIVE' as const,
      from: '2026-08-01T00:00:00Z',
    };
    await controller.getWarehouses();
    await controller.getLedger(filters);
    expect(service.getWarehouses).toHaveBeenCalledTimes(1);
    expect(service.getLedgerEntries).toHaveBeenCalledWith(filters);
  });

  it('استلام: يمرر الـ body + مفتاح idempotency من الترويسة + هوية الجلسة', async () => {
    const body = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantity: 50,
      unitCost: 48,
    };
    await controller.receive(body, 'user-1', 'key-100');
    expect(service.receive).toHaveBeenCalledWith(
      { ...body, idempotencyKey: 'key-100' },
      'user-1',
    );
  });

  it('استلام بلا مفتاح idempotency: يمرر undefined لا يُسقط الحقل', async () => {
    const body = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantity: 50,
      unitCost: 48,
    };
    await controller.receive(body, 'user-1', undefined);
    expect(service.receive).toHaveBeenCalledWith(
      { ...body, idempotencyKey: undefined },
      'user-1',
    );
  });

  it('صرف/تسوية/هدر: تمرير كامل مع المفتاح والهوية', async () => {
    await controller.issue(
      { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 20 },
      'user-1',
      'key-i1',
    );
    expect(service.issue).toHaveBeenCalledWith(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 20,
        idempotencyKey: 'key-i1',
      },
      'user-1',
    );

    const adjustBody = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantityDelta: -3.5,
      reason: 'عجز جرد',
    };
    await controller.adjust(adjustBody, 'user-1', 'key-a1');
    expect(service.adjust).toHaveBeenCalledWith(
      { ...adjustBody, idempotencyKey: 'key-a1' },
      'user-1',
    );

    const wasteBody = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantity: 2.5,
      reason: 'تالف',
    };
    await controller.waste(wasteBody, 'user-1');
    expect(service.waste).toHaveBeenCalledWith(
      { ...wasteBody, idempotencyKey: undefined },
      'user-1',
    );
  });

  // ============ حماية الأدوار (انحدار GF-0003 + مسارات GF-0007) ============

  it('كل مسارات الكتابة مقيّدة بدور INVENTORY_MANAGER فقط', () => {
    const writeRoutes: Array<[string, keyof InventoryController]> = [
      ['addStock', 'addStock'],
      ['receive', 'receive'],
      ['issue', 'issue'],
      ['adjust', 'adjust'],
      ['waste', 'waste'],
    ];
    for (const [method] of writeRoutes) {
      const roles = getMethodMetadata<UserRole[]>(
        ROLES_KEY,
        InventoryController.prototype,
        method,
      );
      expect(roles).toEqual([UserRole.INVENTORY_MANAGER]);
    }
  });

  it('مسارات القراءة (خامات/مخازن/ledger/تام/ملخص) بلا قيد أدوار — لأي مستخدم موثّق', () => {
    const readRoutes = [
      'getRawMaterials',
      'getLowStockMaterials',
      'getWarehouses',
      'getLedger',
      'getFinishedGoods',
      'getSummary',
    ];
    for (const method of readRoutes) {
      const roles = getMethodMetadata<UserRole[] | undefined>(
        ROLES_KEY,
        InventoryController.prototype,
        method,
      );
      expect(roles).toBeUndefined();
    }
  });
});
