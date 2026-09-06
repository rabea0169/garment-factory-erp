import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ROLES_KEY, RolesGuard } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

/**
 * GF-0003/GF-0007 + INV-2 (W2-4): تفويض المخزون وتمرير دور الجلسة —
 * القراءات المادية بلا تكلفة للأدوار التشغيلية، والدفتر (المكلف) للأدوار
 * المالية فقط عبر @Roles — يُختبر سلوك 403 هنا بالـ RolesGuard الحقيقي
 * (Reflector حقيقي يقرأ ميتاداتا المتحكم نفسه) لا بمجرد فحص الميتاداتا.
 */
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
    return: jest.Mock;
    wasteFinishedGood: jest.Mock;
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
      // INV-8: المرتجع من الإنتاج + هدر البضاعة الجاهزة
      return: jest.fn().mockResolvedValue({ replayed: false }),
      wasteFinishedGood: jest.fn().mockResolvedValue({ replayed: false }),
    };
    controller = new InventoryController(
      service as unknown as InventoryService,
    );
  });

  it('يفوّض قراءات المخزون إلى الخدمة مع دور الجلسة (INV-2)', async () => {
    await controller.getRawMaterials({}, UserRole.INVENTORY_MANAGER);
    await controller.getLowStockMaterials({});
    await controller.getFinishedGoods({}, UserRole.ACCOUNTANT);
    await controller.getSummary();
    expect(service.getAllRawMaterials).toHaveBeenCalledWith(
      {},
      UserRole.INVENTORY_MANAGER,
    );
    expect(service.getLowStockMaterials).toHaveBeenCalledTimes(1);
    expect(service.getAllFinishedGoods).toHaveBeenCalledWith(
      {},
      UserRole.ACCOUNTANT,
    );
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
      undefined,
    );
  });

  // ============ GF-0007: المخازن / الـ ledger / الحركات ============

  it('قائمة المخازن وسجل الحركات يُفوَّضان للخدمة مع المرشحات والدور', async () => {
    const filters = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      type: 'RECEIVE' as const,
      from: '2026-08-01T00:00:00Z',
    };
    await controller.getWarehouses({});
    await controller.getLedger(filters, UserRole.ACCOUNTANT);
    expect(service.getWarehouses).toHaveBeenCalledTimes(1);
    expect(service.getLedgerEntries).toHaveBeenCalledWith(
      filters,
      UserRole.ACCOUNTANT,
    );
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

  // ============ INV-8 (GF-IMP-W3): المرتجع وهدر التام ============

  it('INV-8: المرتجع يمرر body (حرفية التكليف: بلا warehouseId) + مفتاح idempotency من الترويسة + هوية الجلسة', async () => {
    const body = {
      rawMaterialId: 'rm-1',
      quantity: 12.5,
      reason: 'بقايا قص',
    };
    await controller.returnStock(body, 'user-1', 'key-ret-1');
    expect(service.return).toHaveBeenCalledWith(
      { ...body, idempotencyKey: 'key-ret-1' },
      'user-1',
    );
  });

  it('INV-8: المرتجع بـ warehouseId صريح يمرر كما هو (اختياري — يوجه لمخزن محدد)', async () => {
    const body = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantity: 5,
      reason: 'إرجاع لمخزن الخط',
    };
    await controller.returnStock(body, 'user-1', 'key-ret-2');
    expect(service.return).toHaveBeenCalledWith(
      { ...body, idempotencyKey: 'key-ret-2' },
      'user-1',
    );
  });

  it('INV-8: هدر البضاعة الجاهزة يمرر body + المفتاح + هوية الجلسة', async () => {
    const body = {
      finishedGoodVariantId: 'pv-1',
      quantity: 3,
      reason: 'تلف بالتخزين',
    };
    await controller.wasteFinishedGood(body, 'user-1', 'key-fgw-1');
    expect(service.wasteFinishedGood).toHaveBeenCalledWith(
      { ...body, idempotencyKey: 'key-fgw-1' },
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
      // INV-8 (GF-IMP-W3): المرتجع + هدر التام — نفس قاعدة الكتابة
      ['returnStock', 'returnStock'],
      ['wasteFinishedGood', 'wasteFinishedGood'],
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

  it('INV-2: الدفتر (القراءة المكلفة) مقيّد بالأدوار المالية فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      InventoryController.prototype,
      'getLedger',
    );
    expect(roles).toEqual([
      UserRole.INVENTORY_MANAGER,
      UserRole.ACCOUNTANT,
      UserRole.GENERAL_MANAGER,
    ]);
  });

  it('INV-2: القراءات المادية (خامات/منخفض/مخازن/أرصدة/تام/ملخص) بلا قيد أدوار — لأي مستخدم موثّق لكن بلا تكلفة للأدوار غير المالية', () => {
    const readRoutes = [
      'getRawMaterials',
      'getLowStockMaterials',
      'getWarehouses',
      'getMaterialBalanceByWarehouse',
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

  // ============ INV-2: سلوك 403/200 بالـ RolesGuard الحقيقي ============

  describe('INV-2: RolesGuard على مسار الدفتر المكلف (سلوك 403)', () => {
    let guard: RolesGuard;

    const guardContext = (role: UserRole | undefined): ExecutionContext =>
      ({
        // مرجع الـ prototype نفسه مقصود: Reflector يقرأ ميتاداتا @Roles
        // المعلنة على الدالة — لا نستدعيها هنا فلا خطر فقدان this.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        getHandler: () => InventoryController.prototype.getLedger,
        getClass: () => InventoryController,
        switchToHttp: () => ({
          getRequest: () => ({ user: role ? { role } : undefined }),
        }),
      }) as unknown as ExecutionContext;

    beforeEach(() => {
      // Reflector حقيقي يقرأ @Roles المُعلن فعليًا على getLedger
      guard = new RolesGuard(new Reflector());
    });

    it.each([
      ['PRODUCTION_MANAGER', UserRole.PRODUCTION_MANAGER],
      ['CASHIER', UserRole.CASHIER],
      ['VIEWER', UserRole.VIEWER],
      ['HR_MANAGER', UserRole.HR_MANAGER],
    ])('دور تشغيلي %s على الدفتر → مرفوض (403)', (_name, role) => {
      // canActivate=false في Nest = ForbiddenException = HTTP 403
      expect(guard.canActivate(guardContext(role))).toBe(false);
    });

    it.each([
      ['INVENTORY_MANAGER', UserRole.INVENTORY_MANAGER],
      ['ACCOUNTANT', UserRole.ACCOUNTANT],
      ['GENERAL_MANAGER', UserRole.GENERAL_MANAGER],
    ])('دور مالي %s على الدفتر → مسموح (يرى unitCost)', (_name, role) => {
      expect(guard.canActivate(guardContext(role))).toBe(true);
    });

    it('SUPER_ADMIN يتجاوز قيد الدفتر دائمًا (سلوك RolesGuard القائم)', () => {
      expect(guard.canActivate(guardContext(UserRole.SUPER_ADMIN))).toBe(true);
    });
  });
});
