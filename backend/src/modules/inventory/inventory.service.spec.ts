import { NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createEventEmitterMock,
  createPrismaMock,
} from '../../../test/helpers/prisma-mock';
import { EVENTS } from '../../events/event-types';

describe('InventoryService — المخزون والأرصدة (GF-0003)', () => {
  let service: InventoryService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    eventEmitter = createEventEmitterMock() as unknown as { emit: jest.Mock };
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
    );
  });

  describe('الخامات', () => {
    it('يجلب كل الخامات مع الموردين مرتبة بالاسم', async () => {
      const materials = [
        { id: 'rm-1', name: 'قماش قطني', supplier: { id: 's-1' } },
      ];
      prisma.rawMaterial.findMany.mockResolvedValue(materials);

      const result = await service.getAllRawMaterials();

      expect(result).toEqual(materials);
      expect(prisma.rawMaterial.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { supplier: true },
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('يعرض فقط الخامات التي رصيدها عند حد الطلب أو أقل (low stock)', async () => {
      prisma.rawMaterial.findMany.mockResolvedValue([
        { id: 'rm-1', currentStock: 5, minStockLevel: 20 }, // منخفض
        { id: 'rm-2', currentStock: 50, minStockLevel: 20 }, // سليم
        { id: 'rm-3', currentStock: 20, minStockLevel: 20 }, // عند الحد بالضبط = منخفض
      ]);

      const result = await service.getLowStockMaterials();

      expect(result.map((m) => m.id)).toEqual(['rm-1', 'rm-3']);
    });

    it('يرمي 404 عند إضافة رصيد لخامة غير موجودة', async () => {
      prisma.rawMaterial.findUnique.mockResolvedValue(null);
      await expect(service.addRawMaterialStock('ghost', 10, 5)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.rawMaterialTransaction.create).not.toHaveBeenCalled();
    });

    it('إضافة رصيد: يسجل حركة PURCHASE ثم يحدّث الرصيد تراكميًا (150+50=200)', async () => {
      prisma.rawMaterial.findUnique.mockResolvedValue({
        id: 'rm-1',
        currentStock: 150,
        minStockLevel: 50,
      });
      prisma.rawMaterial.update.mockResolvedValue({
        id: 'rm-1',
        currentStock: 200,
      });

      const result = await service.addRawMaterialStock('rm-1', 50, 45.5);

      expect(prisma.rawMaterialTransaction.create).toHaveBeenCalledWith({
        data: {
          rawMaterialId: 'rm-1',
          type: 'PURCHASE',
          quantity: 50,
          costPerUnit: 45.5,
          reference: 'إضافة مخزون يدوية',
        },
      });
      expect(prisma.rawMaterial.update).toHaveBeenCalledWith({
        where: { id: 'rm-1' },
        data: { currentStock: 200 },
      });
      expect(result.currentStock).toBe(200);
    });

    it('إضافة رصيد تطلق حدث STOCK_ADDED بالرصيد الجديد', async () => {
      prisma.rawMaterial.findUnique.mockResolvedValue({
        id: 'rm-1',
        currentStock: 150,
      });
      prisma.rawMaterial.update.mockResolvedValue({
        id: 'rm-1',
        currentStock: 200,
      });

      await service.addRawMaterialStock('rm-1', 50, 45.5);

      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.STOCK_ADDED, {
        materialId: 'rm-1',
        quantity: 50,
        newStock: 200,
      });
    });
  });

  describe('المنتج التام والملخص', () => {
    it('يجلب المنتج التام مع الـ variant والمنتج', async () => {
      const goods = [{ id: 'fg-1', variant: { product: { name: 'تيشيرت' } } }];
      prisma.finishedGood.findMany.mockResolvedValue(goods);

      const result = await service.getAllFinishedGoods();

      expect(result).toEqual(goods);
      expect(prisma.finishedGood.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { variant: { include: { product: true } } },
        }),
      );
    });

    it('الملخص يجمع العدادات: خامات + منخفض + أنواع منتج تام', async () => {
      prisma.rawMaterial.count.mockResolvedValue(10);
      prisma.rawMaterial.findMany.mockResolvedValue([
        { currentStock: 1, minStockLevel: 5 },
        { currentStock: 2, minStockLevel: 5 },
        { currentStock: 100, minStockLevel: 5 },
      ]);
      prisma.finishedGood.count.mockResolvedValue(4);

      const result = await service.getDashboardSummary();

      expect(result).toEqual({
        totalMaterials: 10,
        lowStockMaterials: 2,
        totalFinishedGoodsTypes: 4,
      });
    });
  });
});
