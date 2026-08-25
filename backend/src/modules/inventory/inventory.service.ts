import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, StockMovementType, WarehouseType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENTS } from '../../events/event-types';

/**
 * GF-0007 — Domain Foundation: Inventory Application Service (مبدئي).
 *
 * القاعدة المركزية (معيار القبول 2): لا تحديث مباشر لـ RawMaterial.currentStock
 * من أي مكان خارج هذه الخدمة، وداخلها لا يحدث التحديث إلا عبر حركة
 * StockLedgerEntry واحدة داخل prisma.$transaction واحدة:
 *
 *   1. (اختياري) إنشاء سجل IdempotencyKey — نقطة التسلسل ضد التكرار.
 *   2. UPDATE ذري واحد للرصيد { increment: delta } — القيمة الراجعة منه هي
 *      الرصيد الجديد (balanceAfter) وهو نقطة التسلسل ضد السباقات: أي عمليتين
 *      متزامنتين على نفس الخامة تُطبقان واحدة بعد الأخرى، والثانية تقرأ أثر الأولى.
 *   3. فحص الرصيد السالب (ADR-0007): لو ظهر الرصيد سالبًا → استثناء → rollback.
 *   4. (RECEIVE فقط) إعادة احتساب التكلفة بمتوسط مرجح (ADR-0008).
 *   5. إنشاء سطر الـ ledger بلقطة الرصيد بعد الحركة.
 *   6. (اختياري) تخزين الاستجابة في سجل الـ idempotency لإعادة تشغيلها لاحقًا.
 *
 * الأحداث (STOCK_ADDED/STOCK_DEDUCTED/STOCK_LOW) إشعارات in-process غير مالية
 * تُطلق بعد نجاح الـ transaction فقط (وفق اتجاه ADR-0003-ج) — لا اعتماد
 * ذرّيًا عليها.
 */

export interface ReceiveStockInput {
  rawMaterialId: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface IssueStockInput {
  rawMaterialId: string;
  warehouseId: string;
  quantity: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface AdjustStockInput {
  rawMaterialId: string;
  warehouseId: string;
  quantityDelta: number;
  reason: string;
  reference?: string;
  idempotencyKey?: string;
}

export interface WasteStockInput {
  rawMaterialId: string;
  warehouseId: string;
  quantity: number;
  reason: string;
  reference?: string;
  idempotencyKey?: string;
}

export interface StockMovementResult {
  replayed: boolean;
  entryCode: string;
  type: StockMovementType;
  rawMaterialId: string;
  warehouseId: string;
  quantityDelta: number;
  balanceAfter: number;
  unitCost: number | null;
  totalValue: number | null;
  costPerUnitAfter: number | null;
  createdAt: string;
}

export interface LedgerFilter {
  rawMaterialId?: string;
  warehouseId?: string;
  type?: StockMovementType;
  from?: string;
  to?: string;
}

/** نطاقات idempotency — مفتاح واحد لا يُستخدم عبر عمليات مختلفة. */
const IDEMPOTENCY_SCOPES: Record<StockMovementType, string> = {
  [StockMovementType.RECEIVE]: 'inventory.receive',
  [StockMovementType.ISSUE]: 'inventory.issue',
  [StockMovementType.ADJUSTMENT]: 'inventory.adjustment',
  [StockMovementType.WASTE]: 'inventory.waste',
  // RETURN محجوز — يُفعّل مع مرتجعات المشتريات في GF-0009
  [StockMovementType.RETURN]: 'inventory.return',
};

interface MovementExecutionInput {
  type: StockMovementType;
  rawMaterialId: string;
  warehouseId: string;
  /** موقّع: موجب دخول / سالب خروج */
  delta: number;
  /** الكمية الفعلية قبل التوقيع (للأحداث والتكلفة) */
  unsignedQuantity: number;
  unitCost?: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  userId?: string;
}

/** خطأ Prisma معروف (P2002/P2025…) بشكل duck-typing — يعمل مع نسخ runtime المختلفة. */
interface PrismaKnownErrorLike {
  code: string;
  meta?: unknown;
}

function asPrismaKnownError(err: unknown): PrismaKnownErrorLike | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as Partial<PrismaKnownErrorLike>;
  if (typeof candidate.code !== 'string') return null;
  return { code: candidate.code, meta: candidate.meta };
}

/** هل الخطأ تعارض فريد على مفتاح idempotency (وليس أي unique آخر)؟ */
function isIdempotencyUniqueViolation(err: unknown): boolean {
  const known = asPrismaKnownError(err);
  if (!known || known.code !== 'P2002') return false;
  return JSON.stringify(known.meta ?? {}).includes('idempotency');
}

function isRecordNotFound(err: unknown): boolean {
  const known = asPrismaKnownError(err);
  return known !== null && known.code === 'P2025';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** كود حركة فريد قابل للقراءة: SLE-YYYYMMDD-XXXXXXXX (تاريخ UTC + عشوائية). */
function generateEntryCode(): string {
  const now = new Date();
  const ymd = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  return `SLE-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** بصمة الطلب — نفس المفتاح بمحتوى مختلف = تعارض يُرفض بـ 409 لا إعادة تنفيذ. */
function computeRequestHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

type TxClient = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ===================== RAW MATERIALS (reads) =====================

  async getAllRawMaterials() {
    return this.prisma.rawMaterial.findMany({
      include: { supplier: true },
      orderBy: { name: 'asc' },
    });
  }

  async getLowStockMaterials() {
    const materials = await this.prisma.rawMaterial.findMany();
    return materials.filter(
      (m) => Number(m.currentStock) <= Number(m.minStockLevel),
    );
  }

  // ===================== WAREHOUSES (GF-0007) =====================

  async getWarehouses() {
    return this.prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  // ===================== STOCK LEDGER (GF-0007) =====================

  /**
   * قراءة سجل الحركات (الأحدث أولًا) بحد أقصى 200 سطر للحماية من استجابات
   * ضخمة — الـ pagination الكامل لكل القوائم مقرر في GF-0012.
   */
  async getLedgerEntries(filter: LedgerFilter) {
    const where: Prisma.StockLedgerEntryWhereInput = {};
    if (filter.rawMaterialId) where.rawMaterialId = filter.rawMaterialId;
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.type) where.type = filter.type;
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lte: new Date(filter.to) } : {}),
      };
    }
    return this.prisma.stockLedgerEntry.findMany({
      where,
      include: {
        warehouse: { select: { code: true, name: true } },
        rawMaterial: { select: { code: true, name: true, unit: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ===================== MOVEMENT OPERATIONS (GF-0007) =====================

  async receive(
    input: ReceiveStockInput,
    userId?: string,
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement({
      type: StockMovementType.RECEIVE,
      rawMaterialId: input.rawMaterialId,
      warehouseId: input.warehouseId,
      delta: input.quantity,
      unsignedQuantity: input.quantity,
      unitCost: input.unitCost,
      reference: input.reference,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      userId,
    });
  }

  async issue(
    input: IssueStockInput,
    userId?: string,
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement({
      type: StockMovementType.ISSUE,
      rawMaterialId: input.rawMaterialId,
      warehouseId: input.warehouseId,
      delta: -input.quantity,
      unsignedQuantity: input.quantity,
      reference: input.reference,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      userId,
    });
  }

  async adjust(
    input: AdjustStockInput,
    userId?: string,
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement({
      type: StockMovementType.ADJUSTMENT,
      rawMaterialId: input.rawMaterialId,
      warehouseId: input.warehouseId,
      delta: input.quantityDelta,
      unsignedQuantity: Math.abs(input.quantityDelta),
      reference: input.reference,
      notes: `تسوية جرد — السبب: ${input.reason}`,
      idempotencyKey: input.idempotencyKey,
      userId,
    });
  }

  async waste(
    input: WasteStockInput,
    userId?: string,
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement({
      type: StockMovementType.WASTE,
      rawMaterialId: input.rawMaterialId,
      warehouseId: input.warehouseId,
      delta: -input.quantity,
      unsignedQuantity: input.quantity,
      reference: input.reference,
      notes: `هدر — السبب: ${input.reason}`,
      idempotencyKey: input.idempotencyKey,
      userId,
    });
  }

  /**
   * مسار قديم متوافق (POST /inventory/raw-materials/:id/add-stock) —
   * يوجَّه داخليًا عبر receive() في مخزن الخامات الافتراضي، فيمر عبر الـ ledger
   * مثل أي حركة أخرى (معيار القبول 2 بلا استثناءات).
   */
  async addRawMaterialStock(
    materialId: string,
    quantity: number,
    costPerUnit: number,
    userId?: string,
  ): Promise<StockMovementResult> {
    const warehouse = await this.resolveDefaultMaterialWarehouse();
    return this.receive(
      {
        rawMaterialId: materialId,
        warehouseId: warehouse.id,
        quantity,
        unitCost: costPerUnit,
        reference: 'إضافة مخزون يدوية (مسار add-stock)',
      },
      userId,
    );
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

  // ===================== CORE (private) =====================

  /** حركات الخامات تُقبل في مخازن خامات أو عامة فقط — لا في مخازن التام. */
  private async assertMaterialWarehouse(warehouseId: string): Promise<void> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });
    if (!warehouse) {
      throw new NotFoundException('المخزن غير موجود');
    }
    if (!warehouse.isActive) {
      throw new BadRequestException('المخزن غير نشط — لا تُقبل فيه حركات');
    }
    if (
      warehouse.type !== WarehouseType.RAW_MATERIAL &&
      warehouse.type !== WarehouseType.GENERAL
    ) {
      throw new BadRequestException(
        'حركات الخامات تُقبل في مخازن خامات أو عامة فقط — ليس في مخازن المنتج التام',
      );
    }
  }

  private async resolveDefaultMaterialWarehouse() {
    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { type: WarehouseType.RAW_MATERIAL, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    const warehouse =
      rawWarehouse ??
      (await this.prisma.warehouse.findFirst({
        where: { type: WarehouseType.GENERAL, isActive: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!warehouse) {
      throw new ConflictException(
        'لا يوجد مخزن خامات نشط — شغّل seed لإنشاء WH-RAW أو أنشئ مخزنًا أولًا',
      );
    }
    return warehouse;
  }

  private async executeMovement(
    input: MovementExecutionInput,
  ): Promise<StockMovementResult> {
    const scope = IDEMPOTENCY_SCOPES[input.type];
    const requestPayload: Record<string, unknown> = {
      operation: scope,
      rawMaterialId: input.rawMaterialId,
      warehouseId: input.warehouseId,
      quantityDelta: input.delta,
      ...(input.unitCost !== undefined ? { unitCost: input.unitCost } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    const requestHash = computeRequestHash(requestPayload);

    // (1) إعادة تشغيل idempotent: نفس المفتاح + نفس المحتوى → نفس الاستجابة بلا أثر جديد.
    if (input.idempotencyKey) {
      const replay = await this.tryReplay(
        input.idempotencyKey,
        scope,
        requestHash,
      );
      if (replay) return replay;
    }

    // (2) التنفيذ الذري: كل الكتابات عبر tx فقط.
    let eventContext:
      | {
          materialId: string;
          warehouseId: string;
          quantity: number;
          newBalance: number;
          minStockLevel: number;
        }
      | undefined;

    try {
      const result = await this.prisma.$transaction(async (tx: TxClient) => {
        let idempotencyKeyId: string | undefined;
        if (input.idempotencyKey) {
          const idem = await tx.idempotencyKey.create({
            data: {
              key: input.idempotencyKey,
              scope,
              requestHash,
            },
            select: { id: true },
          });
          idempotencyKeyId = idem.id;
        }

        // UPDATE ذري واحد = نقطة التسلسل: القيمة الراجعة هي الرصيد بعد التطبيق،
        // وأي عملية متزامنة على نفس الخامة تنتظر قفل الصف ثم ترى أثر هذه.
        let material: {
          currentStock: Prisma.Decimal | number;
          costPerUnit: Prisma.Decimal | number;
          minStockLevel: Prisma.Decimal | number;
        };
        try {
          material = await tx.rawMaterial.update({
            where: { id: input.rawMaterialId },
            data: { currentStock: { increment: input.delta } },
            select: {
              currentStock: true,
              costPerUnit: true,
              minStockLevel: true,
            },
          });
        } catch (err) {
          if (isRecordNotFound(err)) {
            throw new NotFoundException('المادة الخام غير موجودة');
          }
          throw err;
        }

        const newBalance = Number(material.currentStock);
        const currentCost = Number(material.costPerUnit);
        const minStockLevel = Number(material.minStockLevel);

        // ADR-0007: الرصيد السالب ممنوع — الاستثناء يُرجع الـ transaction كلها.
        if (newBalance < 0) {
          throw new BadRequestException(
            `العملية تُظهر رصيد الخامة إلى ${newBalance} — الرصيد السالب ممنوع (ADR-0007). ` +
              'تحقق من الكمية أو سجّل تسوية جرد أولًا.',
          );
        }

        // التكلفة المطبقة وتقييم الحركة.
        let appliedUnitCost: number;
        let totalValue: number;
        let costPerUnitAfter: number | null = null;
        if (input.type === StockMovementType.RECEIVE) {
          const unitCost = input.unitCost as number;
          const oldQuantity = newBalance - input.unsignedQuantity;
          // ADR-0008 — متوسط مرجح: تكلفة الوحدة الجديدة = (كمية×تكلفة قديمة + كمية×تكلفة الشحنة) / الرصيد الجديد.
          const newCost =
            oldQuantity <= 0
              ? unitCost
              : round2(
                  (oldQuantity * currentCost +
                    input.unsignedQuantity * unitCost) /
                    newBalance,
                );
          costPerUnitAfter = newCost;
          await tx.rawMaterial.update({
            where: { id: input.rawMaterialId },
            data: { costPerUnit: newCost },
          });
          appliedUnitCost = unitCost;
          totalValue = round2(input.unsignedQuantity * unitCost);
        } else {
          appliedUnitCost = currentCost;
          totalValue = round2(input.unsignedQuantity * currentCost);
        }

        const entry = await tx.stockLedgerEntry.create({
          data: {
            entryCode: generateEntryCode(),
            type: input.type,
            warehouseId: input.warehouseId,
            rawMaterialId: input.rawMaterialId,
            quantityDelta: input.delta,
            balanceAfter: newBalance,
            unitCost: appliedUnitCost,
            totalValue,
            reference: input.reference,
            notes: input.notes,
            idempotencyKeyId,
            createdById: input.userId,
          },
          select: { entryCode: true, createdAt: true },
        });

        const response: Omit<StockMovementResult, 'replayed'> = {
          entryCode: entry.entryCode,
          type: input.type,
          rawMaterialId: input.rawMaterialId,
          warehouseId: input.warehouseId,
          quantityDelta: input.delta,
          balanceAfter: newBalance,
          unitCost: appliedUnitCost,
          totalValue,
          costPerUnitAfter,
          createdAt: entry.createdAt.toISOString(),
        };

        if (input.idempotencyKey) {
          await tx.idempotencyKey.update({
            where: { key: input.idempotencyKey },
            data: { response: response },
          });
        }

        eventContext = {
          materialId: input.rawMaterialId,
          warehouseId: input.warehouseId,
          quantity: input.unsignedQuantity,
          newBalance,
          minStockLevel,
        };

        return { ...response, replayed: false };
      });

      // (3) إشعارات بعد نجاح الـ transaction فقط (غير مالية — ADR-0003-ج).
      if (eventContext) {
        const isInbound =
          input.type === StockMovementType.RECEIVE ||
          input.type === StockMovementType.RETURN;
        this.eventEmitter.emit(
          isInbound ? EVENTS.STOCK_ADDED : EVENTS.STOCK_DEDUCTED,
          {
            materialId: eventContext.materialId,
            warehouseId: eventContext.warehouseId,
            quantity: eventContext.quantity,
            newStock: eventContext.newBalance,
          },
        );
        if (
          eventContext.newBalance <= eventContext.minStockLevel &&
          eventContext.minStockLevel > 0
        ) {
          this.eventEmitter.emit(EVENTS.STOCK_LOW, {
            materialId: eventContext.materialId,
            currentStock: eventContext.newBalance,
            minStockLevel: eventContext.minStockLevel,
          });
        }
      }

      return result;
    } catch (err) {
      // (4) سباق idempotency: عملية أخرى بنفس المفتاح التزمت قبلك — استرجع استجابتها.
      if (isIdempotencyUniqueViolation(err) && input.idempotencyKey) {
        const replay = await this.tryReplay(
          input.idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay;
        throw new ConflictException(
          'العملية بنفس المفتاح قيد التنفيذ أو فشلت قبل الاكتمال — أعد المحاولة بعد لحظات',
        );
      }
      throw err;
    }
  }

  /** إعادة استجابة مخزنة لمفتاح مكتمل — أو رفض واضح عند تعارض المحتوى/النطاق. */
  private async tryReplay(
    key: string,
    scope: string,
    requestHash: string,
  ): Promise<StockMovementResult | null> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (!existing) return null;

    if (existing.scope !== scope) {
      throw new ConflictException(
        `المفتاح مستخدم مسبقًا في نطاق مختلف (${existing.scope}) — استخدم مفتاحًا جديدًا`,
      );
    }
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'نفس مفتاح idempotency مع محتوى طلب مختلف — ممنوع (استخدم مفتاحًا جديدًا للمحتوى الجديد)',
      );
    }
    if (!existing.response) {
      throw new ConflictException(
        'توجد محاولة سابقة غير مكتملة بنفس المفتاح — أعد المحاولة بمفتاح جديد',
      );
    }
    return {
      ...(existing.response as unknown as Omit<
        StockMovementResult,
        'replayed'
      >),
      replayed: true,
    };
  }
}
