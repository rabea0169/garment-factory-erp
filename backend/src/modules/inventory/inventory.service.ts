import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, StockMovementType, WarehouseType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENTS } from '../../events/event-types';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';

/**
 * GF-0007 — Domain Foundation: Inventory Application Service (مبدئي).
 *
 * القاعدة المركزية (معيار القبول 2): لا تحديث مباشر لـ RawMaterial.currentStock
 * من أي مكان خارج هذه الخدمة، وداخلها لا يحدث التحديث إلا عبر حركة
 * StockLedgerEntry واحدة داخل prisma.$transaction واحدة:
 *
 *   1. (اختياري) إنشاء سجل IdempotencyKey — نقطة التسلسل ضد التكرار.
 *   2. UPDATE ذري واحد للرصيد الإجمالي { increment: delta } — وهو نقطة التسلسل
 *      ضد السباقات على نفس الخامة.
 *   3. تجميع ledger داخل نفس المعاملة لحساب رصيد المستودع بعد الحركة؛ وبذلك
 *      لا يسمح الصرف بتجاوز رصيد مستودع بعينه حتى لو كان الإجمالي موجبًا.
 *   4. فحص الرصيد السالب الإجمالي ورصيد المستودع (ADR-0007): الاستثناء يعيد
 *      المعاملة كلها.
 *   5. (RECEIVE فقط) إعادة احتساب التكلفة بمتوسط مرجح (ADR-0008).
 *   6. إنشاء سطر الـ ledger بلقطة رصيد المستودع بعد الحركة.
 *   7. (اختياري) تخزين الاستجابة في سجل الـ idempotency لإعادة تشغيلها لاحقًا.
 *
 * الأحداث (STOCK_ADDED/STOCK_DEDUCTED/STOCK_LOW) إشعارات in-process غير مالية
 * تُطلق بعد نجاح الـ transaction فقط (وفق اتجاه ADR-0003-ج) — لا اعتماد
 * ذرّيًا عليها.
 */

export interface ReceiveStockInput {
  rawMaterialId?: string;
  productVariantId?: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface IssueStockInput {
  rawMaterialId?: string;
  productVariantId?: string;
  warehouseId: string;
  quantity: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface AdjustStockInput {
  rawMaterialId?: string;
  productVariantId?: string;
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
  /** الرصيد بعد الحركة في المستودع المحدد، وليس الإجمالي عبر كل المستودعات. */
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

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
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

  async getAllRawMaterials(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.rawMaterial.findMany({
        skip,
        take: limit,
        include: { supplier: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.rawMaterial.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async getLowStockMaterials(pagination: PaginationDto) {
    // B2: نستخدم $queryRaw SQL بدلاً من findMany + in-memory filter.
    // الفلاتر في الـ SQL تقلل نقل البيانات وتسمح للـ DB بـ index scans.
    // D7 (partial): لا نُرجع costPerUnit — بيانات التكلفة role-restricted.
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const offset = (page - 1) * limit;

    // PostgreSQL syntax — `currentStock` و `minStockLevel` columns من نوع Decimal
    // نُرجعها كـ numeric، نُحوّلها لـ number في TS.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        currentStock: import('@prisma/client').Prisma.Decimal;
        minStockLevel: import('@prisma/client').Prisma.Decimal;
        unit: string | null;
        supplierId: string | null;
      }>
    >`
      SELECT id, code, name, "currentStock", "minStockLevel", unit, "supplierId"
      FROM raw_materials
      WHERE "currentStock" <= "minStockLevel"
      ORDER BY (("minStockLevel" - "currentStock")) DESC, name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // عدّ الإجمالي للـ pagination meta
    const totalRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM raw_materials
      WHERE "currentStock" <= "minStockLevel"
    `;
    const total = Number(totalRows[0]?.count ?? 0);

    // نُنظّف الـ rows من Big number إلى plain JS objects
    const data = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      // D7: costPerUnit غائب عمداً — لا يُرجع من هنا.
      currentStock: Number(r.currentStock),
      minStockLevel: Number(r.minStockLevel),
      unit: r.unit,
      supplierId: r.supplierId,
    }));

    return new PaginatedResult(data, total, page, limit);
  }

  /**
   * GF-REMAINING-002: يجلب رصيد المادة الخام لكل مستودع من مجموع الحركات.
   *
   * RawMaterial.currentStock هو الإجمالي الكلي (snapshot للقراءة السريعة)،
   * أما الرصيد التشغيلي لكل مستودع فيُستخرج من SUM(quantityDelta) في الـ ledger.
   * لا نستخدم balanceAfter هنا لأنه لقطة تدقيق لا مصدر تجميع، وقد تكون قديمة
   * أو كُتبت في إصدار سابق بدلالة إجمالي الخامة.
   *
   * @param rawMaterialId المادة الخام المطلوبة
   * @returns مصفوفة لكل مستودع يحوي الكمية الحالية + آخر تحديث
   */
  async getMaterialBalanceByWarehouse(rawMaterialId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        warehouseId: string;
        warehouseCode: string;
        warehouseName: string;
        balance: import('@prisma/client').Prisma.Decimal;
        lastUpdate: Date;
      }>
    >`
      SELECT
        sle."warehouseId",
        w.code AS "warehouseCode",
        w.name AS "warehouseName",
        COALESCE(SUM(sle."quantityDelta"), 0) AS balance,
        MAX(sle."createdAt") AS "lastUpdate"
      FROM stock_ledger_entries sle
      JOIN warehouses w ON w.id = sle."warehouseId"
      WHERE sle."rawMaterialId" = ${rawMaterialId}
      GROUP BY sle."warehouseId", w.code, w.name
      ORDER BY w.code ASC
    `;

    return rows.map((r) => ({
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouseCode,
      warehouseName: r.warehouseName,
      balance: Number(r.balance),
      lastUpdate: r.lastUpdate,
    }));
  }

  // ===================== WAREHOUSES (GF-0007) =====================

  async getWarehouses(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isActive: true },
        skip,
        take: limit,
        orderBy: { code: 'asc' },
      }),
      this.prisma.warehouse.count({ where: { isActive: true } }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  // ===================== STOCK LEDGER (GF-0007) =====================

  async getLedgerEntries(filter: LedgerFilter & PaginationDto) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

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
    const [data, total] = await Promise.all([
      this.prisma.stockLedgerEntry.findMany({
        where,
        skip,
        take: limit,
        include: {
          warehouse: { select: { code: true, name: true } },
          rawMaterial: { select: { code: true, name: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockLedgerEntry.count({ where }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  // ===================== MOVEMENT OPERATIONS (GF-0007) =====================

  async receive(
    input: ReceiveStockInput,
    userId?: string,
    tx?: TxClient,
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement(
      {
        type: StockMovementType.RECEIVE,
        rawMaterialId: this.requireRawMaterialId(input.rawMaterialId),
        warehouseId: input.warehouseId,
        delta: input.quantity,
        unsignedQuantity: input.quantity,
        unitCost: input.unitCost,
        reference: input.reference,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        userId,
      },
      tx,
    );
  }

  async issue(
    input: IssueStockInput,
    userId?: string,
    tx?: TxClient,
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement(
      {
        type: StockMovementType.ISSUE,
        rawMaterialId: this.requireRawMaterialId(input.rawMaterialId),
        warehouseId: input.warehouseId,
        delta: -input.quantity,
        unsignedQuantity: input.quantity,
        reference: input.reference,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        userId,
      },
      tx,
    );
  }

  async adjust(
    input: AdjustStockInput,
    userId?: string,
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement({
      type: StockMovementType.ADJUSTMENT,
      rawMaterialId: this.requireRawMaterialId(input.rawMaterialId),
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

  async receiveFinishedGood(
    input: {
      productVariantId: string;
      warehouseId: string;
      quantity: number;
      unitCost: number;
      reference?: string;
      notes?: string;
      idempotencyKey?: string;
    },
    userId?: string,
    externalTx?: TxClient,
  ): Promise<StockMovementResult> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException(
        'كمية المنتج التام يجب أن تكون عددًا صحيحًا موجبًا',
      );
    }
    if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
      throw new BadRequestException(
        'تكلفة وحدة المنتج التام يجب أن تكون رقمًا غير سالب',
      );
    }

    const client = externalTx ?? this.prisma;
    const warehouse = await client.warehouse.findUnique({
      where: { id: input.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    if (
      !warehouse.isActive ||
      warehouse.type !== WarehouseType.FINISHED_GOODS
    ) {
      throw new BadRequestException('الحركة تتطلب مخزن منتج تام نشط');
    }

    const scope = 'inventory.finished_good_receive';
    const requestHash = computeRequestHash({
      operation: scope,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });
    if (input.idempotencyKey) {
      const replay = await this.tryReplay(
        input.idempotencyKey,
        scope,
        requestHash,
      );
      if (replay) return replay;
    }

    const execute = async (tx: TxClient): Promise<StockMovementResult> => {
      let idempotencyKeyId: string | undefined;
      if (input.idempotencyKey) {
        idempotencyKeyId = (
          await tx.idempotencyKey.create({
            data: { key: input.idempotencyKey, scope, requestHash },
            select: { id: true },
          })
        ).id;
      }

      await tx.$executeRaw(
        Prisma.sql`INSERT INTO "finished_good_stocks"
          ("id", "warehouseId", "productVariantId", "quantity", "unitCost", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${input.warehouseId}, ${input.productVariantId}, ${input.quantity}, ${input.unitCost}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("warehouseId", "productVariantId") DO UPDATE SET
          "unitCost" = CASE
            WHEN "finished_good_stocks"."quantity" + EXCLUDED."quantity" = 0 THEN 0
            ELSE (("finished_good_stocks"."quantity" * "finished_good_stocks"."unitCost") + (EXCLUDED."quantity" * EXCLUDED."unitCost"))
              / ("finished_good_stocks"."quantity" + EXCLUDED."quantity")
          END,
          "quantity" = "finished_good_stocks"."quantity" + EXCLUDED."quantity",
          "updatedAt" = CURRENT_TIMESTAMP`,
      );

      const stock = await tx.finishedGoodStock.findUniqueOrThrow({
        where: {
          warehouseId_productVariantId: {
            warehouseId: input.warehouseId,
            productVariantId: input.productVariantId,
          },
        },
      });
      const entry = await tx.stockLedgerEntry.create({
        data: {
          entryCode: generateEntryCode(),
          type: StockMovementType.RECEIVE,
          warehouseId: input.warehouseId,
          productVariantId: input.productVariantId,
          quantityDelta: input.quantity,
          balanceAfter: stock.quantity,
          unitCost: input.unitCost,
          totalValue: new Prisma.Decimal(input.unitCost).mul(input.quantity),
          reference: input.reference,
          notes: input.notes,
          idempotencyKeyId,
          createdById: userId,
        },
        select: { entryCode: true, createdAt: true },
      });
      const response = {
        replayed: false,
        entryCode: entry.entryCode,
        type: StockMovementType.RECEIVE,
        rawMaterialId: '',
        warehouseId: input.warehouseId,
        quantityDelta: input.quantity,
        balanceAfter: stock.quantity,
        unitCost: input.unitCost,
        totalValue: new Prisma.Decimal(input.unitCost)
          .mul(input.quantity)
          .toNumber(),
        costPerUnitAfter: stock.unitCost.toNumber(),
        createdAt: entry.createdAt.toISOString(),
      } satisfies StockMovementResult;
      if (input.idempotencyKey) {
        await tx.idempotencyKey.update({
          where: { key: input.idempotencyKey },
          data: { response },
        });
      }
      return response;
    };

    try {
      return await (externalTx
        ? execute(externalTx)
        : this.prisma.$transaction(execute));
    } catch (error) {
      if (input.idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replay = await this.tryReplay(
          input.idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  async issueFinishedGood(
    input: {
      productVariantId: string;
      warehouseId: string;
      quantity: number;
      reference?: string;
      notes?: string;
      idempotencyKey?: string;
    },
    userId?: string,
    externalTx?: TxClient,
  ): Promise<StockMovementResult> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException(
        'كمية المنتج التام يجب أن تكون عددًا صحيحًا موجبًا',
      );
    }
    const client = externalTx ?? this.prisma;
    const warehouse = await client.warehouse.findUnique({
      where: { id: input.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    if (
      !warehouse.isActive ||
      warehouse.type !== WarehouseType.FINISHED_GOODS
    ) {
      throw new BadRequestException('الحركة تتطلب مخزن منتج تام نشط');
    }

    const scope = 'inventory.finished_good_issue';
    const requestHash = computeRequestHash({
      operation: scope,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });
    if (input.idempotencyKey) {
      const existing = await client.idempotencyKey.findUnique({
        where: { key: input.idempotencyKey },
      });
      if (existing) {
        if (existing.scope !== scope || existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key مستخدم مع عملية مختلفة');
        }
        if (!existing.response)
          throw new ConflictException('العملية السابقة لم تكتمل بعد');
        return {
          ...(existing.response as unknown as Omit<
            StockMovementResult,
            'replayed'
          >),
          replayed: true,
        };
      }
    }

    const execute = async (tx: TxClient): Promise<StockMovementResult> => {
      const idempotencyKeyId = input.idempotencyKey
        ? (
            await tx.idempotencyKey.create({
              data: { key: input.idempotencyKey, scope, requestHash },
              select: { id: true },
            })
          ).id
        : undefined;
      const stock = await tx.finishedGoodStock.findUnique({
        where: {
          warehouseId_productVariantId: {
            warehouseId: input.warehouseId,
            productVariantId: input.productVariantId,
          },
        },
        select: { id: true, quantity: true, unitCost: true },
      });
      if (!stock)
        throw new NotFoundException(
          'رصيد المنتج التام غير موجود في المخزن المحدد',
        );
      const updated = await tx.finishedGoodStock.updateMany({
        where: { id: stock.id, quantity: { gte: input.quantity } },
        data: { quantity: { decrement: input.quantity } },
      });
      if (updated.count !== 1) {
        throw new ConflictException('المخزون التام غير كافٍ أو تغير بالتزامن');
      }
      const balanceAfter = stock.quantity - input.quantity;
      const entry = await tx.stockLedgerEntry.create({
        data: {
          entryCode: generateEntryCode(),
          type: StockMovementType.ISSUE,
          warehouseId: input.warehouseId,
          productVariantId: input.productVariantId,
          quantityDelta: -input.quantity,
          balanceAfter,
          unitCost: stock.unitCost,
          totalValue: stock.unitCost.mul(input.quantity),
          reference: input.reference,
          notes: input.notes,
          idempotencyKeyId,
          createdById: userId,
        },
        select: { entryCode: true, createdAt: true },
      });
      const response = {
        replayed: false,
        entryCode: entry.entryCode,
        type: StockMovementType.ISSUE,
        rawMaterialId: '',
        warehouseId: input.warehouseId,
        quantityDelta: -input.quantity,
        balanceAfter,
        unitCost: stock.unitCost.toNumber(),
        totalValue: stock.unitCost.mul(input.quantity).toNumber(),
        costPerUnitAfter: null,
        createdAt: entry.createdAt.toISOString(),
      } satisfies StockMovementResult;
      if (input.idempotencyKey) {
        await tx.idempotencyKey.update({
          where: { key: input.idempotencyKey },
          data: { response },
        });
      }
      return response;
    };

    try {
      return await (externalTx
        ? execute(externalTx)
        : this.prisma.$transaction(execute));
    } catch (error) {
      if (input.idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replay = await this.tryReplay(
          input.idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  async getAllFinishedGoods(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.FinishedGoodStockWhereInput = {
      quantity: { gt: 0 },
    };
    const [rows, total] = await Promise.all([
      this.prisma.finishedGoodStock.findMany({
        skip,
        take: limit,
        where,
        include: {
          productVariant: {
            include: { product: true },
          },
          warehouse: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.finishedGoodStock.count({ where }),
    ]);
    const data = rows.map(({ productVariant, ...stock }) => ({
      ...stock,
      variant: productVariant,
    }));

    return new PaginatedResult(data, total, page, limit);
  }

  async getDashboardSummary() {
    const materials = await this.prisma.rawMaterial.count();
    const lowStock = (
      await this.getLowStockMaterials({ page: 1, limit: 10000 })
    ).data.length;
    const finishedGoods = await this.prisma.finishedGoodStock.count({
      where: { quantity: { gt: 0 } },
    });

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

  private requireRawMaterialId(rawMaterialId?: string): string {
    if (!rawMaterialId) {
      throw new BadRequestException('rawMaterialId مطلوب لهذه الحركة');
    }
    return rawMaterialId;
  }

  private async executeMovement(
    input: MovementExecutionInput,
    externalTx?: TxClient,
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

    const executeLogic = async (tx: TxClient) => {
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
      const warehouseAggregate = await tx.stockLedgerEntry.aggregate({
        where: {
          rawMaterialId: input.rawMaterialId,
          warehouseId: input.warehouseId,
        },
        _sum: { quantityDelta: true },
      });
      const warehouseBalanceBefore = Number(
        warehouseAggregate._sum.quantityDelta ?? 0,
      );
      const warehouseBalanceAfter = round4(
        warehouseBalanceBefore + input.delta,
      );

      // ADR-0007: الرصيد السالب ممنوع — الإجمالي والمستودع كلاهما يُفحصان،
      // والاستثناء يُرجع الـ transaction كلها.
      if (newBalance < 0) {
        throw new BadRequestException(
          `العملية تُظهر رصيد الخامة إلى ${newBalance} — الرصيد السالب ممنوع (ADR-0007). ` +
            'تحقق من الكمية أو سجّل تسوية جرد أولًا.',
        );
      }
      if (warehouseBalanceAfter < 0) {
        throw new BadRequestException(
          `العملية تُظهر رصيد المستودع إلى ${warehouseBalanceAfter} — الرصيد السالب ممنوع (ADR-0007). ` +
            'تحقق من المستودع أو سجّل تسوية جرد أولًا.',
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
          balanceAfter: warehouseBalanceAfter,
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
        balanceAfter: warehouseBalanceAfter,
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
        newBalance: warehouseBalanceAfter,
        minStockLevel,
      };

      return { ...response, replayed: false };
    };

    try {
      const result = externalTx
        ? await executeLogic(externalTx)
        : await this.prisma.$transaction(executeLogic);

      // (3) إشعارات بعد نجاح الـ transaction فقط (غير مالية — ADR-0003-ج).
      if (eventContext) {
        const isInbound =
          input.type === StockMovementType.RECEIVE ||
          input.type === StockMovementType.RETURN;
        void this.eventEmitter.emitAsync(
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
          void this.eventEmitter.emitAsync(EVENTS.STOCK_LOW, {
            materialId: eventContext.materialId,
            warehouseId: eventContext.warehouseId,
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
