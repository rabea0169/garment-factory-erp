import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('InventoryController — التفويض وتمرير العمليات (GF-0003)', () => {
  let controller: InventoryController;
  let service: {
    getAllRawMaterials: jest.Mock;
    getLowStockMaterials: jest.Mock;
    addRawMaterialStock: jest.Mock;
    getAllFinishedGoods: jest.Mock;
    getDashboardSummary: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getAllRawMaterials: jest.fn().mockResolvedValue([]),
      getLowStockMaterials: jest.fn().mockResolvedValue([]),
      addRawMaterialStock: jest.fn().mockResolvedValue({ id: 'rm-1' }),
      getAllFinishedGoods: jest.fn().mockResolvedValue([]),
      getDashboardSummary: jest.fn().mockResolvedValue({}),
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

  it('إضافة رصيد تمرر (id, quantity, costPerUnit) بالترتيب الصحيح', async () => {
    const body = { quantity: 50, costPerUnit: 45.5 };
    await controller.addStock('rm-1', body);
    expect(service.addRawMaterialStock).toHaveBeenCalledWith('rm-1', 50, 45.5);
  });

  it('إضافة الرصيد مقيّدة بدور INVENTORY_MANAGER فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      InventoryController.prototype,
      'addStock',
    );
    expect(roles).toEqual([UserRole.INVENTORY_MANAGER]);
  });
});
