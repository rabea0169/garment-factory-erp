import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdjustmentStatus, Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { round2, round4 } from '../../core/common/money.util';
import {
  CreateInventoryAdjustmentDto,
  InventoryAdjustmentItemInputDto,
} from './dto/create-inventory-adjustment.dto';
import { QueryInventoryAdjustmentDto } from './dto/query-inventory-adjustment.dto';

/** لقطة بند الجرد المحسوبة على الخادم (قبل الإنشاء). */
interface AdjustmentItemSnapshot {
  rawMaterialId: string | null;
  productVariantId: string | null;
  itemName: string;
  unit: string;
  systemQty: number;
  actualQty: number;
  difference: number;
  unitCost: number;
  valueDifference: number;
}

/** مستند التسوية كما يمرر لمعاملة الاعتماد (حقول الاستخدام فقط). */
interface AdjustmentForApproval {
  id: string;
  code: string;
  warehouseId: string;
  date: Date;
}

/** بند بضاعة جاهزة للتطبيق داخل معاملة الاعتماد. */
interface FinishedGoodAdjustmentItem {
  id: string;
  productVariantId: string;
  itemName: string;
  difference: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

/**
 * SELIM-ERP W1 — خدمة تسويات الجرد (تقلد /api/inventory-adjustments في
 * Selim ERP) — آلة حالات كاملة:
 *
 *   DRAFT → (approve) → APPROVED
 *        ↘ (reject)  → REJECTED
 *
 * قواعد المجال (من Selim وتُنفَّذ حرفيًا):
 * - الإنشاء مسودة فقط بلا أي أثر: الخادم يحسب لكل بند رصيد النظام
 *   (systemQty من StockLedgerEntry للخامات / FinishedGoodStock للتام)،
 *   والفرق (difference = actual − system) وقيمته المالية
 *   (valueDifference = difference × unitCost) — العميل يرسل العدّ الفعلي
 *   فقط، ولا يرسل فرقًا ولا حالة (نفس قاعدة "الإجماليات على الخادم").
 * - الترقيم ADJ-0001 عبر SequenceService داخل معاملة الإنشاء.
 * - الاعتماد: DRAFT فقط، وبنود بفرق ≠ 0 فقط:
 *     • الخامات: عبر InventoryService.adjust — المحرك الموحد لحركات
 *       المخزون (يرحّل قيد GL لكل بند: Dr INVENTORY / Cr
 *       INVENTORY_ADJUSTMENT_INCOME للموجب، وDr INVENTORY_ADJUSTMENT_
 *       EXPENSE / Cr INVENTORY للسالب). ملاحظة توثيقية: adjust() لا يقبل
 *       tx خارجيًا (توقيعه: input, userId, eventsCollector) فيدير معاملته
 *       بنفسه — لذلك تُنفَّذ حركات الخامات قبل معاملة قلب الحالة، مع
 *       حراسة idempotent لكل بند (مرجع الدفتر = كود التسوية) تمنع ازدواج
 *       التطبيق عند إعادة المحاولة بعد فشل لاحق.
 *     • البضاعة الجاهزة: حركة الدفتر تُنشأ مباشرة داخل معاملة الاعتماد
 *       (tx.stockLedgerEntry.create بنمط executeMovement في
 *       inventory.service) + تحديث FinishedGoodStock + قيد GL واحد لكل
 *       بند (Dr FINISHED_GOOD_STOCK / Cr INVENTORY_ADJUSTMENT_INCOME
 *       للموجب — Dr INVENTORY_ADJUSTMENT_EXPENSE / Cr FINISHED_GOOD_STOCK
 *       للسالب)، ثم قلب الحالة DRAFT→APPROVED بـ CAS ضد السباق.
 * - الرفض: DRAFT فقط + سبب إلزامي (rejectedReason) — لا أثر مخزوني.
 * - الحذف: DRAFT فقط — لم تُطبق فروقه بعد فلا شيء يُعكس.
 */
@Injectable()
export class InventoryAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly financial: FinancialPostingService,
    private readonly inventory: InventoryService,
  ) {}

  /** إنشاء مسودة تسوية بحساب فروق النظام على الخادم (بلا أي أثر). */
  async create(dto: CreateInventoryAdjustmentDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // (1) ترقيم تسلسلي داخل معاملة الإنشاء — يتراجع مع أي فشل.
      const code = await this.sequence.nextNumber('INVENTORY_ADJUSTMENT', tx);

      // (2) المخزن المجرد — موجود ونشط.
      const warehouse = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });
      if (!warehouse) throw new NotFoundException('المخزن غير موجود');
      if (!warehouse.isActive) {
        throw new BadRequestException('المخزن غير نشط — لا تُقبل فيه تسويات');
      }

      // (3) لقطة كل بند: رصيد النظام + الفرق + القيمة — كلها على الخادم.
      const itemSnapshots: AdjustmentItemSnapshot[] = [];
      for (const item of dto.items) {
        itemSnapshots.push(
          await this.buildItemSnapshot(tx, dto.warehouseId, item),
        );
      }

      return tx.inventoryAdjustment.create({
        data: {
          code,
          warehouseId: dto.warehouseId,
          date: dto.date ?? undefined,
          status: AdjustmentStatus.DRAFT,
          notes: dto.notes,
          createdById: userId,
          items: {
            create: itemSnapshots.map((snapshot) => ({
              rawMaterialId: snapshot.rawMaterialId,
              productVariantId: snapshot.productVariantId,
              itemName: snapshot.itemName,
              unit: snapshot.unit,
              systemQty: new Prisma.Decimal(snapshot.systemQty),
              actualQty: new Prisma.Decimal(snapshot.actualQty),
              difference: new Prisma.Decimal(snapshot.difference),
              unitCost: new Prisma.Decimal(snapshot.unitCost),
              valueDifference: new Prisma.Decimal(snapshot.valueDifference),
            })),
          },
        },
        include: {
          items: true,
          warehouse: { select: { id: true, code: true, name: true } },
        },
      });
    });
  }

  /**
   * اعتماد التسوية — DRAFT فقط. حركات الخامات عبر InventoryService.adjust
   * (idempotent لكل بند)، ثم معاملة واحدة تحوي حركات البضاعة الجاهزة
   * (دفتر + رصيد + قيد) وقلب الحالة إلى APPROVED.
   */
  async approve(id: string, userId: string) {
    const adjustment = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!adjustment) throw new NotFoundException('تسوية الجرد غير موجودة');
    if (adjustment.status !== AdjustmentStatus.DRAFT) {
      throw new BadRequestException('لا يمكن اعتماد إلا تسوية في حالة مسودة');
    }

    // (أ) الخامات: عبر المحرك الموحد adjust() — قبل معاملة الحالة.
    //     الحراسة: إن وُجد بند دفتر بمرجع كود التسوية للخامة نفسها فهو
    //     مطبَّق سابقًا (إعادة محاولة بعد فشل لاحق) — يُتخطى بلا ازدواج.
    for (const item of adjustment.items) {
      if (!item.rawMaterialId) continue;
      const difference = Number(item.difference);
      if (difference === 0) continue;
      const applied = await this.prisma.stockLedgerEntry.findFirst({
        where: {
          reference: adjustment.code,
          rawMaterialId: item.rawMaterialId,
          type: StockMovementType.ADJUSTMENT,
        },
        select: { id: true },
      });
      if (applied) continue;
      await this.inventory.adjust(
        {
          rawMaterialId: item.rawMaterialId,
          warehouseId: adjustment.warehouseId,
          quantityDelta: difference,
          reason: adjustment.notes ?? `اعتماد تسوية جرد ${adjustment.code}`,
          reference: adjustment.code,
        },
        userId,
      );
    }

    // (ب) البضاعة الجاهزة + قلب الحالة — معاملة واحدة ذرّية.
    return this.prisma.$transaction(async (tx) => {
      for (const item of adjustment.items) {
        if (!item.productVariantId) continue;
        const difference = Number(item.difference);
        if (difference === 0) continue;
        await this.applyFinishedGoodAdjustment(
          tx,
          {
            id: adjustment.id,
            code: adjustment.code,
            warehouseId: adjustment.warehouseId,
            date: adjustment.date,
          },
          {
            id: item.id,
            productVariantId: item.productVariantId,
            itemName: item.itemName,
            difference: item.difference,
            unitCost: item.unitCost,
          },
          userId,
        );
      }

      // CAS ضد السباق: قلب DRAFT→APPROVED مشروط ببقائها DRAFT.
      const flipped = await tx.inventoryAdjustment.updateMany({
        where: { id, status: AdjustmentStatus.DRAFT },
        data: {
          status: AdjustmentStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      if (flipped.count !== 1) {
        throw new ConflictException(
          'تمت معالجة التسوية بالتزامن — أعد تحميل الصفحة',
        );
      }

      return tx.inventoryAdjustment.findUnique({
        where: { id },
        include: {
          items: true,
          warehouse: { select: { id: true, code: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
    });
  }

  /** رفض مسودة تسوية بسبب إلزامي — DRAFT فقط. */
  async reject(id: string, reason: string) {
    const existing = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('تسوية الجرد غير موجودة');
    if (existing.status !== AdjustmentStatus.DRAFT) {
      throw new BadRequestException('لا يمكن رفض إلا تسوية في حالة مسودة');
    }
    return this.prisma.inventoryAdjustment.update({
      where: { id },
      data: { status: AdjustmentStatus.REJECTED, rejectedReason: reason },
      include: {
        items: true,
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });
  }

  /** قائمة التسويات بفلترة حالة/مخزن/تاريخ + ترقيم صفحات. */
  async findAll(query: QueryInventoryAdjustmentDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.InventoryAdjustmentWhereInput = {};
    if (query.status) {
      where.status = query.status as AdjustmentStatus;
    }
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryAdjustment.findMany({
        where,
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inventoryAdjustment.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** تفاصيل تسوية ببنودها وصف التسوية/الاعتماد. */
  async findOne(id: string) {
    const adjustment = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      include: {
        items: true,
        warehouse: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (!adjustment) throw new NotFoundException('تسوية الجرد غير موجودة');
    return adjustment;
  }

  /** حذف مسودة — DRAFT فقط (لم تُطبق فروقها فلا شيء يُعكس). */
  async remove(id: string) {
    const existing = await this.prisma.inventoryAdjustment.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('تسوية الجرد غير موجودة');
    if (existing.status !== AdjustmentStatus.DRAFT) {
      throw new BadRequestException(
        'لا يمكن حذف تسوية معتمدة أو مرفوضة — سجلها التدقيقي محفوظ',
      );
    }
    await this.prisma.inventoryAdjustment.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * لقطة بند الجرد: رصيد النظام من مصدره الصحيح (دفتر الخامات أو رصيد
   * البضاعة الجاهزة) + الفرق + القيمة المالية — كلها على الخادم.
   */
  private async buildItemSnapshot(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    item: InventoryAdjustmentItemInputDto,
  ): Promise<AdjustmentItemSnapshot> {
    // XOR: خامة أو توليفة — لا كلاهما ولا بلا منهما (نمط StockLedgerEntry).
    if (Boolean(item.rawMaterialId) === Boolean(item.productVariantId)) {
      throw new BadRequestException(
        `البند "${item.itemName}" يجب أن يشير إلى خامة أو توليفة منتج — لا كلاهما ولا بلا منهما`,
      );
    }

    if (item.rawMaterialId) {
      const material = await tx.rawMaterial.findUnique({
        where: { id: item.rawMaterialId },
        select: { id: true, name: true, unit: true, costPerUnit: true },
      });
      if (!material) {
        throw new NotFoundException(
          `الخامة المحددة في البند "${item.itemName}" غير موجودة`,
        );
      }
      // رصيد النظام = مجموع حركات الدفتر للخامة في هذا المخزن تحديدًا.
      const aggregate = await tx.stockLedgerEntry.aggregate({
        where: { rawMaterialId: item.rawMaterialId, warehouseId },
        _sum: { quantityDelta: true },
      });
      const systemQty = round4(Number(aggregate._sum.quantityDelta ?? 0));
      const unitCost = round4(Number(material.costPerUnit));
      const difference = round4(item.actualQty - systemQty);
      return {
        rawMaterialId: item.rawMaterialId,
        productVariantId: null,
        itemName: item.itemName,
        unit: item.unit,
        systemQty,
        actualQty: round4(item.actualQty),
        difference,
        unitCost,
        valueDifference: round2(difference * unitCost),
      };
    }

    // بند بضاعة جاهزة: رصيد النظام من FinishedGoodStock (كميات صحيحة).
    // (فحص XOR أعلاه يضمن تعريف productVariantId هنا — الخامة وحدها عادت.)
    const variantId = item.productVariantId as string;
    if (!Number.isInteger(item.actualQty)) {
      throw new BadRequestException(
        `كمية البند "${item.itemName}" غير صحيحة — كميات المنتج التام أعداد صحيحة`,
      );
    }
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { name: true } } },
    });
    if (!variant) {
      throw new NotFoundException(
        `التوليفة المحددة في البند "${item.itemName}" غير موجودة`,
      );
    }
    const stock = await tx.finishedGoodStock.findUnique({
      where: {
        warehouseId_productVariantId: {
          warehouseId,
          productVariantId: variantId,
        },
      },
    });
    const systemQty = stock ? Number(stock.quantity) : 0;
    const unitCost = stock ? round4(Number(stock.unitCost)) : 0;
    const difference = round4(item.actualQty - systemQty);
    return {
      rawMaterialId: null,
      productVariantId: variantId,
      itemName: item.itemName,
      unit: item.unit,
      systemQty,
      actualQty: round4(item.actualQty),
      difference,
      unitCost,
      valueDifference: round2(difference * unitCost),
    };
  }

  /**
   * تطبيق تسوية بضاعة جاهزة داخل معاملة الاعتماد — نفس نمط executeMovement
   * في inventory.service: تحديث رصيد FinishedGoodStock (بحراسة سالب)،
   * سطر دفتر ADJUSTMENT موصول بالتوليفة، وقيد GL لكل بند بمبلغ القيمة.
   */
  private async applyFinishedGoodAdjustment(
    tx: Prisma.TransactionClient,
    adjustment: AdjustmentForApproval,
    item: FinishedGoodAdjustmentItem,
    userId: string,
  ) {
    const difference = Number(item.difference);
    const stock = await tx.finishedGoodStock.findUnique({
      where: {
        warehouseId_productVariantId: {
          warehouseId: adjustment.warehouseId,
          productVariantId: item.productVariantId,
        },
      },
    });
    const currentQty = stock ? Number(stock.quantity) : 0;
    const newQty = currentQty + difference;
    if (newQty < 0) {
      throw new BadRequestException(
        `التسوية تُظهر رصيد المنتج التام "${item.itemName}" إلى ${newQty} — الرصيد السالب ممنوع`,
      );
    }
    const unitCost = Number(item.unitCost);

    if (!stock) {
      if (difference <= 0) {
        throw new BadRequestException(
          `لا يوجد رصيد للمنتج "${item.itemName}" في هذا المخزن — لا تسوية سالبة بلا رصيد`,
        );
      }
      await tx.finishedGoodStock.create({
        data: {
          warehouseId: adjustment.warehouseId,
          productVariantId: item.productVariantId,
          quantity: newQty,
          unitCost: new Prisma.Decimal(unitCost),
        },
      });
    } else {
      await tx.finishedGoodStock.update({
        where: {
          warehouseId_productVariantId: {
            warehouseId: adjustment.warehouseId,
            productVariantId: item.productVariantId,
          },
        },
        data: { quantity: { increment: difference } },
      });
    }

    // سطر الدفتر — لقطة الرصيد بعد الحركة (نفس حقول executeMovement).
    await tx.stockLedgerEntry.create({
      data: {
        entryCode: InventoryAdjustmentsService.generateEntryCode(),
        type: StockMovementType.ADJUSTMENT,
        warehouseId: adjustment.warehouseId,
        productVariantId: item.productVariantId,
        quantityDelta: new Prisma.Decimal(difference),
        balanceAfter: new Prisma.Decimal(newQty),
        unitCost: new Prisma.Decimal(unitCost),
        totalValue: new Prisma.Decimal(round2(Math.abs(difference) * unitCost)),
        reference: adjustment.code,
        notes: `تسوية جرد ${adjustment.code} — ${item.itemName}`,
        createdById: userId,
      },
    });

    // قيد GL للبند — postingKey مستقر على البند يمنع الترحيل المزدوج.
    const glAmount = round2(Math.abs(difference) * unitCost);
    if (glAmount > 0) {
      const isPositive = difference > 0;
      await this.financial.postJournalEntryInTx(
        tx,
        {
          description: `ترحيل تسوية جرد منتج تام — ${adjustment.code}`,
          reference: adjustment.code,
          isAuto: true,
          lines: [
            {
              debitAccountId: isPositive
                ? CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK
                : CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_EXPENSE,
              creditAccountId: isPositive
                ? CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_INCOME
                : CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
              amount: glAmount,
              description: `${isPositive ? 'زيادة' : 'نقص'} جرد — ${item.itemName}`,
            },
          ],
          postingKey: `adjustment-fg:${item.id}`,
          metadata: {
            source: 'INVENTORY_ADJUSTMENT',
            adjustmentId: adjustment.id,
            adjustmentCode: adjustment.code,
            itemId: item.id,
            productVariantId: item.productVariantId,
            warehouseId: adjustment.warehouseId,
            delta: difference,
            unitCost,
          },
          date: adjustment.date,
        },
        userId,
      );
    }
  }

  /** كود حركة فريد قابل للقراءة — نفس صيغة inventory.service (SLE-...). */
  private static generateEntryCode(): string {
    const now = new Date();
    const ymd = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('');
    return `SLE-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
