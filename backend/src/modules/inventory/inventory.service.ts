import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../../events/event-types';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ===================== RAW MATERIALS =====================

  async getAllRawMaterials() {
    return this.prisma.rawMaterial.findMany({
      include: { supplier: true },
      orderBy: { name: 'asc' },
    });
  }

  async getLowStockMaterials() {
    const materials = await this.prisma.rawMaterial.findMany();
    return materials.filter(m => m.currentStock <= m.minStockLevel);
  }

  async addRawMaterialStock(materialId: string, quantity: number, costPerUnit: number) {
    const material = await this.prisma.rawMaterial.findUnique({ where: { id: materialId } });
    if (!material) throw new NotFoundException('المادة الخام غير موجودة');

    // إنشاء حركة مخزن
    const transaction = await this.prisma.rawMaterialTransaction.create({
      data: {
        rawMaterialId: materialId,
        type: 'PURCHASE',
        quantity: quantity,
        costPerUnit: costPerUnit,
        reference: 'إضافة مخزون يدوية',
      },
    });

    // تحديث الرصيد
    const newStock = Number(material.currentStock) + quantity;
    const updated = await this.prisma.rawMaterial.update({
      where: { id: materialId },
      data: { currentStock: newStock },
    });

    this.eventEmitter.emit(EVENTS.STOCK_ADDED, { materialId, quantity, newStock });
    return updated;
  }

  // ===================== FINISHED GOODS =====================

  async getAllFinishedGoods() {
    return this.prisma.finishedGood.findMany({
      include: {
        variant: {
          include: { product: true },
        },
      },
      orderBy: { variant: { product: { name: 'asc' } } },
    });
  }

  async getDashboardSummary() {
    const materials = await this.prisma.rawMaterial.count();
    const lowStock = (await this.getLowStockMaterials()).length;
    const finishedGoods = await this.prisma.finishedGood.count();

    return {
      totalMaterials: materials,
      lowStockMaterials: lowStock,
      totalFinishedGoodsTypes: finishedGoods,
    };
  }
}
