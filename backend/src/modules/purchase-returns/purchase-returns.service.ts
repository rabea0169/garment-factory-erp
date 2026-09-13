import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
  PurchaseReturnStatus,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import {
  FinancialPostingService,
  JournalLineInput,
} from '../../core/financial/financial-posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { round2 } from '../../core/common/money.util';
import {
  CreatePurchaseReturnDto,
  PurchaseReturnItemInputDto,
} from './dto/create-purchase-return.dto';
import { QueryPurchaseReturnDto } from './dto/query-purchase-return.dto';

/**
 * SELIM-ERP W1 — خدمة مرتجع المشتريات (تقلد /api/purchase-returns في
 * Selim ERP).
 *
 * القواعد المحاسبية (من المرجع Selim وتُنفَّذ حرفيًا):
 * - المرتجع يصدر دائمًا عن أمر شراء قائم، والمورد لقطة منه — لا يُحدد
 *   المورد من الطلب أبدًا (مصدر الحقيقة واحد).
 * - الإجماليات تُحسب على الخادم: subtotal = Σ(كمية × سعر استرداد)،
 *   total = subtotal − discountAmount + taxAmount.
 * - ترقيم PRR-0001 عبر SequenceService داخل نفس معاملة الإنشاء.
 * - القيد العكسي لعملية الشراء داخل نفس المعاملة:
 *     restockItems=true  → Dr ACCOUNTS_PAYABLE (أو CASH عند استرداد نقدي)
 *                          / Cr INVENTORY بصافي البنود، وعند وجود ضريبة
 *                          بند إضافي Dr نفس الحساب / Cr VAT_PAYABLE —
 *                          عكس قيد الاستلام (Dr INVENTORY / Cr AP + VAT).
 *     restockItems=false → Dr ACCOUNTS_PAYABLE (أو CASH) / Cr
 *                          COST_OF_GOODS_SOLD (مصروف معاكس) بلا حركة
 *                          مخزون — الخصم المالي فقط.
 * - استرداد credit يخفض رصيد المورد (supplierUpdates داخل القيد — نفس
 *   نمط returnToSupplier)؛ استرداد cash لا يمس رصيد المورد (النقد عاد
 *   مباشرة من المورد) ويقيد Dr CASH.
 * - restockItems=true يحرك المخزون فعليًا: صرف الخامات من مخزن استلام
 *   أمر الشراء (أو مخزن الخامات الافتراضي كملاذ) عبر InventoryService.issue
 *   داخل نفس المعاملة — نفس مسار returnToSupplier القائم.
 * - الحذف يعكس القيد عبر reverseJournalEntryInTx (يعيد رصيد المورد/
 *   حسابات GL من لقطات ACC-2) ويستعيد الكميات عبر InventoryService.receive
 *   ثم يحذف — كله في معاملة واحدة (نفس نمط voidOrder للمبيعات).
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly financial: FinancialPostingService,
    private readonly inventory: InventoryService,
  ) {}

  /** إنشاء مرتجع مشتريات بترقيم تسلسلي وقيد عكسي وحركة مخزون ذرّية. */
  async create(dto: CreatePurchaseReturnDto, userId: string) {
    const restockItems = dto.restockItems ?? true;
    const refundMethod = dto.refundMethod ?? 'credit';

    return this.prisma.$transaction(async (tx) => {
      // (1) ترقيم تسلسلي داخل معاملة الإنشاء — يتراجع مع أي فشل.
      const returnNumber = await this.sequence.nextNumber(
        'PURCHASE_RETURN',
        tx,
      );

      // (2) أمر الشراء الأصل + المورد لقطة — بلا أمر لا مرتجع.
      const order = await tx.purchaseOrder.findUnique({
        where: { id: dto.purchaseOrderId },
        include: {
          items: true,
          supplier: { select: { id: true, name: true } },
        },
      });
      if (!order) throw new NotFoundException('أمر الشراء غير موجود');
      if (order.status === PurchaseOrderStatus.CANCELLED) {
        throw new BadRequestException('لا يمكن إنشاء مرتجع على أمر شراء ملغى');
      }

      // (3) ربط البنود بأمر الشراء + استكمال لقطات الخامة والاسم والتكلفة.
      const resolvedItems = this.resolveItems(dto.items, order.items);
      const materialIds = [
        ...new Set(
          resolvedItems
            .map((item) => item.rawMaterialId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const materials = materialIds.length
        ? await tx.rawMaterial.findMany({
            where: { id: { in: materialIds } },
            select: {
              id: true,
              name: true,
              code: true,
              costPerUnit: true,
            },
          })
        : [];
      const materialById = new Map(materials.map((m) => [m.id, m]));
      for (const id of materialIds) {
        if (!materialById.has(id)) {
          throw new BadRequestException('خامة في بنود المرتجع غير موجودة');
        }
      }
      for (const item of resolvedItems) {
        const material = item.rawMaterialId
          ? materialById.get(item.rawMaterialId)
          : undefined;
        if (material && !item.rawMaterialName) {
          item.rawMaterialName = material.name;
        }
        if (material && item.unitCost === undefined) {
          // التكلفة الدفترية الحالية (متوسط مرجح) — لقطة عند الإنشاء.
          item.unitCost = Number(material.costPerUnit);
        }
      }

      // (4) الإجماليات على الخادم — لا تُقبل من العميل أبدًا.
      const subtotal = round2(
        resolvedItems.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0,
        ),
      );
      const discountAmount = dto.discountAmount ?? 0;
      if (discountAmount > subtotal) {
        throw new BadRequestException(
          'خصم المرتجع لا يمكن أن يتجاوز مجموع البنود',
        );
      }
      const taxAmount = dto.taxAmount ?? 0;
      const netAmount = round2(subtotal - discountAmount);
      const total = round2(netAmount + taxAmount);

      // (5) إنشاء المستند ببنوده (الحالة POSTED — القيد فوري داخل نفس المعاملة).
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          returnNumber,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          supplierName: order.supplier?.name ?? 'مورد غير محدد',
          date: dto.date ?? undefined,
          subtotal: new Prisma.Decimal(subtotal),
          discountAmount: new Prisma.Decimal(discountAmount),
          taxAmount: new Prisma.Decimal(taxAmount),
          total: new Prisma.Decimal(total),
          reason: dto.reason,
          restockItems,
          refundMethod,
          status: PurchaseReturnStatus.POSTED,
          notes: dto.notes,
          createdById: userId,
          items: {
            create: resolvedItems.map((item) => ({
              purchaseOrderItemId: item.purchaseOrderItemId,
              rawMaterialId: item.rawMaterialId,
              rawMaterialName: item.rawMaterialName,
              quantity: new Prisma.Decimal(item.quantity),
              unitPrice: new Prisma.Decimal(item.unitPrice),
              unitCost: new Prisma.Decimal(item.unitCost ?? 0),
              total: new Prisma.Decimal(round2(item.quantity * item.unitPrice)),
              reason: item.reason,
            })),
          },
        },
        include: { items: true },
      });

      // (6) القيد العكسي داخل نفس المعاملة (لا مرتجع بلا قيد — قاعدة Selim).
      const debitAccountId =
        refundMethod === 'cash'
          ? CHART_OF_ACCOUNTS.CASH
          : CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE;
      const creditAccountId = restockItems
        ? CHART_OF_ACCOUNTS.INVENTORY
        : CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD;
      const lines: JournalLineInput[] = [];
      if (netAmount > 0) {
        lines.push({
          debitAccountId,
          creditAccountId,
          amount: netAmount,
          description: `عكس قيمة مرتجع المورد ${order.supplier?.name ?? ''} — أمر الشراء ${order.code}`,
        });
      }
      if (taxAmount > 0) {
        // عكس ضريبة المشتريات المدفوعة — يخفض الالتزام الضريبي المستحق
        // بنسبة المرتجع (نفس نمط Selim: Cr INVENTORY + Cr VAT_PAYABLE).
        lines.push({
          debitAccountId,
          creditAccountId: CHART_OF_ACCOUNTS.VAT_PAYABLE,
          amount: taxAmount,
          description: 'عكس ضريبة مشتريات مرتجعة',
        });
      }
      let journalEntryId: string | undefined;
      if (lines.length > 0) {
        const journal = await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `مرتجع مشتريات ${returnNumber}`,
            reference: returnNumber,
            isAuto: true,
            lines,
            supplierUpdates:
              refundMethod === 'credit'
                ? [{ supplierId: order.supplierId, delta: -total }]
                : undefined,
            metadata: {
              source: 'PURCHASE_RETURN',
              purchaseReturnId: purchaseReturn.id,
              purchaseOrderId: order.id,
              supplierId: order.supplierId,
              refundMethod,
              restockItems,
              subtotal,
              taxAmount,
              total,
            },
            postingKey: `purchase-return:${purchaseReturn.id}`,
          },
          userId,
        );
        journalEntryId = journal.entryId;
      }

      // (7) حركة المخزون الفعلية (restockItems=true): صرف الخامات من
      //     مخزن استلام أمر الشراء (أو الافتراضي) — داخل نفس المعاملة.
      if (restockItems && materialIds.length > 0) {
        const warehouseId = await this.resolveReturnWarehouse(
          tx,
          order.id,
          materialIds,
        );
        for (const item of resolvedItems) {
          if (!item.rawMaterialId) continue;
          await this.inventory.issue(
            {
              rawMaterialId: item.rawMaterialId,
              warehouseId,
              quantity: item.quantity,
              reference: returnNumber,
              notes: `مرتجع مشتريات ${returnNumber} — أمر الشراء ${order.code}`,
            },
            userId,
            tx,
          );
        }
      }

      return tx.purchaseReturn.update({
        where: { id: purchaseReturn.id },
        data: { journalEntryId: journalEntryId ?? null },
        include: {
          items: true,
          supplier: { select: { id: true, name: true, phone: true } },
          purchaseOrder: { select: { id: true, code: true, status: true } },
          journalEntry: { select: { id: true, code: true } },
        },
      });
    });
  }

  /** قائمة المرتجعات ببحث رقم/مورد + نطاق تاريخي + فلترة مورد + ترقيم. */
  async findAll(query: QueryPurchaseReturnDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PurchaseReturnWhereInput = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { returnNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseReturn.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, phone: true } },
          purchaseOrder: { select: { id: true, code: true, status: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseReturn.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** تفاصيل مرتجع واحد ببنوده وقيدة وربه بأمر الشراء. */
  async findOne(id: string) {
    const purchaseReturn = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: {
        items: true,
        supplier: { select: { id: true, name: true, phone: true } },
        purchaseOrder: { select: { id: true, code: true, status: true } },
        journalEntry: { select: { id: true, code: true, isReversed: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!purchaseReturn)
      throw new NotFoundException('مرتجع المشتريات غير موجود');
    return purchaseReturn;
  }

  /**
   * حذف مرتجع — عكس القيد (يعيد رصيد المورد وحسابات GL من لقطات ACC-2)
   * ثم استعادة الكميات إن كان المرتجع حرّك المخزون، ثم الحذف — كله في
   * معاملة واحدة (نفس نمط voidOrder لأوامر البيع المؤكدة).
   */
  async remove(id: string, userId: string) {
    const existing = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('مرتجع المشتريات غير موجود');

    await this.prisma.$transaction(async (tx) => {
      // (1) عكس القيد المالي إن وُجد — يرفع الحظر قبل أي أثر لاحق.
      if (existing.journalEntryId) {
        await this.financial.reverseJournalEntryInTx(
          tx,
          existing.journalEntryId,
          userId,
          `حذف مرتجع المشتريات ${existing.returnNumber} — عكس القيد`,
        );
      }

      // (2) استعادة الكميات للمخزن إن كان المرتجع صرفها فعليًا —
      //     بنفس التكلفة المرتجعة (unitCost) كي يعدّل المتوسط المرجح عدلًا.
      if (existing.restockItems) {
        const materialIds = existing.items
          .map((item) => item.rawMaterialId)
          .filter((mid): mid is string => Boolean(mid));
        if (materialIds.length > 0) {
          const warehouseId = await this.resolveReturnWarehouse(
            tx,
            existing.purchaseOrderId,
            materialIds,
          );
          for (const item of existing.items) {
            if (!item.rawMaterialId) continue;
            await this.inventory.receive(
              {
                rawMaterialId: item.rawMaterialId,
                warehouseId,
                quantity: Number(item.quantity),
                unitCost: Number(item.unitCost) || 0,
                reference: `${existing.returnNumber}-DELETE`,
                notes: `استعادة كميات بعد حذف مرتجع ${existing.returnNumber}`,
              },
              userId,
              tx,
            );
          }
        }
      }

      await tx.purchaseReturn.delete({ where: { id } });
    });
    return { deleted: true };
  }

  /**
   * ربط بنود الطلب بأمر الشراء: بند بأصل (purchaseOrderItemId) يجب أن
   * ينتمي للأمر؛ بند بلا أصل ولا خامة يُرفض (لا يمكن ربطه بشيء).
   */
  private resolveItems(
    items: PurchaseReturnItemInputDto[],
    orderItems: Array<{
      id: string;
      rawMaterialId: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
    }>,
  ) {
    return items.map((item) => {
      let rawMaterialId = item.rawMaterialId ?? null;
      if (item.purchaseOrderItemId) {
        const orderItem = orderItems.find(
          (oi) => oi.id === item.purchaseOrderItemId,
        );
        if (!orderItem) {
          throw new BadRequestException(
            'بند مرتجع يشير إلى بند غير موجود في أمر الشراء المحدد',
          );
        }
        // بند الأصل هو مصدر الحقيقة للخامة إن لم تحدد صراحةً.
        if (!rawMaterialId) rawMaterialId = orderItem.rawMaterialId;
      }
      if (!rawMaterialId && !item.rawMaterialName) {
        throw new BadRequestException(
          'كل بند مرتجع يجب أن يرتبط ببند أمر الشراء أو يحدد الخامة بالمعرف أو الاسم',
        );
      }
      return {
        purchaseOrderItemId: item.purchaseOrderItemId ?? null,
        rawMaterialId,
        rawMaterialName: item.rawMaterialName ?? '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost: item.unitCost,
        reason: item.reason,
      };
    });
  }

  /**
   * مخزن صرف المرتجع: مخزن آخر استلام فعلي لأمر الشراء (من بنود GRN عبر
   * دفتر المخزون — الكمية وصلت هناك فيُرجع من هناك)؛ وملاذًا مخزن الخامات
   * الافتراضي (نمط INV-6: أول مخزن خامات نشط بترتيب createdAt — نفس
   * حتمية resolveDefaultMaterialWarehouse في InventoryService).
   */
  private async resolveReturnWarehouse(
    tx: Prisma.TransactionClient,
    purchaseOrderId: string,
    materialIds: string[],
  ): Promise<string> {
    if (materialIds.length > 0) {
      const receipts = await tx.purchaseReceipt.findMany({
        where: { purchaseOrderId },
        select: { code: true },
        orderBy: { receivedAt: 'desc' },
      });
      if (receipts.length > 0) {
        const entry = await tx.stockLedgerEntry.findFirst({
          where: {
            rawMaterialId: { in: materialIds },
            reference: { in: receipts.map((r) => r.code) },
          },
          orderBy: { createdAt: 'desc' },
          select: { warehouseId: true },
        });
        if (entry) return entry.warehouseId;
      }
    }
    const rawWarehouse = await tx.warehouse.findFirst({
      where: { type: WarehouseType.RAW_MATERIAL, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!rawWarehouse) {
      throw new ConflictException(
        'لا يوجد مخزن خامات نشط — شغّل seed لإنشاء WH-RAW أو أنشئ مخزنًا أولًا',
      );
    }
    return rawWarehouse.id;
  }
}
